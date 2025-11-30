import express from "express";
import cors from "cors";
import * as tdl from "tdl";
import { getTdjson } from "prebuilt-tdlib";
import turndown from "turndown";
import bodyParser from "body-parser";
import "dotenv/config";
import "dotenv";
import { CronJob, timeout } from "cron";

const TG_API_HASH = process.env.TG_API_HASH!;
const TG_API_ID = Number(process.env.TG_API_ID!);
const TG_CHANNEL_NAME = process.env.TG_CHANNEL_NAME!;

const MWS_TABLE_ID = process.env.MWS_TABLE_ID!;
const MWS_TABLES_API_KEY = process.env.MWS_TABLES_API_KEY!;
const MWS_POSTS_TABLE = process.env.MWS_POSTS_TABLE!;

const HABR_COLLECT_USER = process.env.HABR_COLLECT_USER!;
const VC_COLLECT_USER = process.env.VC_COLLECT_USER!;

const SENT_ANALYZE_URL = process.env.SENT_ANALYZE_URL!;

tdl.configure({ tdjson: getTdjson() });
const tgclient = tdl.createClient({
  apiHash: TG_API_HASH,
  apiId: TG_API_ID,
});

const html2md = new turndown();

const getTgPosts = async () => {
  await tgclient.login();
  const chat = await tgclient.invoke({
    _: "searchPublicChat",
    username: TG_CHANNEL_NAME, // без @
  });
  let fromMessageId = 0;
  let count = 0;
  const msgs: NonNullable<
    Awaited<
      ReturnType<typeof tgclient.invoke<"getChatHistory">>
    >["messages"][number]
  >[] = [];

  while (true) {
    if (fromMessageId === -1) break;
    if (count >= 10) break;

    const history = await tgclient.invoke({
      _: "getChatHistory",
      chat_id: chat.id,
      from_message_id: fromMessageId,
      limit: 100,
    });

    const messages = history.messages.filter(
      (e): e is NonNullable<typeof e> => !!e
    );
    if (!messages || messages.length === 0) break;

    for (const msg of messages) {
      msgs.push(msg);
    }

    fromMessageId = messages[messages.length - 1]?.id ?? -1;
    count++;
  }

  return msgs;
};

class Source implements ISource {
  constructor(private options: SourceOptions) {}

  public getCollectPaths = async () => {
    const [paths, parser] = this.options.pathCollectPaths;
    const collectPath = await Promise.allSettled(
      paths.map((p) =>
        fetch(`${this.options.baseUrl}${p}`)
          .then((res) => res.json())
          .then((data) => parser(data as Record<string, unknown>))
      )
    );

    return collectPath
      .filter((e) => e.status === "fulfilled")
      .map((e) => (e as PromiseFulfilledResult<string[]>).value);
  };

  public getPosts = async () => {
    const collectPaths = await this.getCollectPaths();
    const [postPath, postParser] = this.options.collectPostBasePath;

    const posts = (
      await Promise.allSettled(
        collectPaths
          .map((paths) => {
            return paths.map(async (path) => {
              const postResponse = await fetch(
                `${this.options.baseUrl}${postPath}${path}`
              );
              const postData = await postResponse.json();
              return postParser(postData as Record<string, unknown>);
            });
          })
          .flat()
      )
    )
      .filter((e) => e.status === "fulfilled")
      .map((e) => (e as PromiseFulfilledResult<Post>).value);

    return posts;
  };

  public rank = async (comments: Comment[]) => {
    if (!comments.length) {
      return null;
    }

    return (
      (await (
        await fetch(SENT_ANALYZE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            texts: comments
              .map((e) => html2md.turndown(e.content))
              .filter((e) => e),
          }),
        })
      ).json()) as {
        results: {
          text: string;
          sentiment: string;
          confidence: number;
        }[];
      }
    ).results
      .map((e) => ({
        ...comments.find((el) =>
          html2md.turndown(el.content)?.includes(e.text)
        ),
        sentiment: e.sentiment,
        confidence: e.confidence,
      }))
      .filter((e) => !!e);
  };

  public getComments = async (postId: string) => {
    if (!this.options.collectCommentsBasePath) return [];
    const [path, parser] = this.options.collectCommentsBasePath;
    const res = await fetch(
      `${this.options.baseUrl}${path.replace("{id}", postId)}`
    );
    const json = await res.json();
    const parsed = parser(json as Record<string, unknown>).map((e) => ({
      ...e,
      postId,
    }));
    const ranked = await this.rank(parsed);

    return ranked!;
  };
}

interface ISource {
  getCollectPaths: () => Promise<string[][]>;
  getPosts: () => Promise<Post[]>;
  getComments?: (postId: string) => Promise<
    {
      sentiment: string;
      confidence: number;
      postId?: string;
      content?: string;
      score?: number;
    }[]
  >;
}

class TgSource implements ISource {
  private options = {
    baseUrl: "",
    pathCollectPaths: [
      [] as string[],
      (_: Record<string, unknown>) => [] as string[],
    ] as [string[], (res: Record<string, unknown>) => string[]],
    collectPostBasePath: [
      "",
      (_: Record<string, unknown>) => ({
        commentsCount: 0,
        dislikes: 0,
        favoritesCount: 0,
        likes: 0,
        name: "",
        postId: "",
        readingCount: 0,
        reach: 0,
        readers: 0,
        tags: [] as string[],
      }),
    ] as [string, (res: Record<string, unknown>) => Post],
  };

  public getCollectPaths: () => Promise<string[][]> = async () => {
    return [];
  };
  public getPosts: () => Promise<Post[]> = async () => {
    const messages = await getTgPosts();
    const positiveEmojis = [
      "👍",
      "❤️",
      "🔥",
      "😂",
      "🎉",
      "💖",
      "🤩",
      "😍",
      "😁",
      "🥳",
      "💯",
      "✨",
      "😎",
      "😃",
      "🤗",
    ];
    const negativeEmojis = [
      "👎",
      "😡",
      "🤬",
      "😠",
      "🙄",
      "😤",
      "😢",
      "💔",
      "😭",
      "😒",
      "🤯",
      "💩",
      "🤡",
    ];

    return messages
      .map((el) => {
        return el;
      })
      .filter((el) =>
        el.content._ === "messageText"
          ? !!el.content.text.text
          : el.content._ === "messagePhoto"
          ? !!el.content.caption.text
          : false
      )
      .map((el) => ({
        postId: `${el.id}`,
        readingCount: el.interaction_info?.view_count!,
        commentsCount: 0,
        favoritesCount: el.interaction_info?.forward_count!,
        reach: 0,
        readers: 0,
        tags: [
          ...(el.content._ === "messageText"
            ? el.content.text.text
            : el.content._ === "messagePhoto"
            ? el.content.caption.text
            : ""
          )
            .matchAll(/(#(?:[^\x00-\x7F]|\w)+)/gim)
            .map((el) => el[1]!),
        ],
        name: `${
          el.content._ === "messageText"
            ? el.content.text.text
            : el.content._ === "messagePhoto"
            ? el.content.caption.text
            : ""
        }`.split("\n\n")[0]!,
        likes:
          el.interaction_info?.reactions?._ === "messageReactions"
            ? el.interaction_info.reactions.reactions
                .filter((el) => el.type._ === "reactionTypeEmoji")
                .map((el) =>
                  el.type._ === "reactionTypeEmoji"
                    ? Number(positiveEmojis.includes(el.type.emoji))
                    : 0
                )
                .reduce((a, b) => a + b, 0)
            : 0,
        dislikes:
          el.interaction_info?.reactions?._ === "messageReactions"
            ? el.interaction_info.reactions.reactions
                .filter((el) => el.type._ === "reactionTypeEmoji")
                .map((el) =>
                  el.type._ === "reactionTypeEmoji"
                    ? Number(negativeEmojis.includes(el.type.emoji))
                    : 0
                )
                .reduce((a, b) => a + b, 0)
            : 0,
      }));
  };
}

class Collector {
  constructor(
    private source: ISource,
    public options: {
      collectType: string;
      baseUrl: string;
      savePostPath: [string, (post: Post) => WatchablePost];
      saveCommentsPath?: [
        string,
        (comments: {
          sentiment: string;
          confidence: number;
          postId?: string;
          content?: string;
          score?: number;
        }) => WatchableComment
      ];
      apiKey?: string;
    }
  ) {}

  async execute() {
    try {
      const posts = await this.source.getPosts();
      const watchablePosts = await this.getWatchablePosts();
      if (this.source.getComments && this.options.saveCommentsPath) {
        const comments = (
          await Promise.allSettled(
            posts
              .map((e) => e.postId)
              .map((e) => this.source.getComments?.(e))
              .filter((e) => e)
          )
        )
          .filter((e) => e.status === "fulfilled")
          .map((e) => e.value)
          .filter((e) => e)
          .flat();

        if (comments) {
          const [_, parser] = this.options.saveCommentsPath;
          const watchableComments = await this.getWatchableComments();

          const updatedComments = comments
            .filter((comment) => {
              return (
                comment &&
                watchableComments.data.records
                  .map((e) => e.fields["Текст"])
                  .includes(comment.content)
              );
            })
            .reduce<{ fieldKey: "name"; records: WatchableCommentRecord[] }>(
              (acc, comment) => ({
                records: [
                  ...acc.records,
                  ...(!comment
                    ? []
                    : [
                        {
                          fields: {
                            ...parser(comment).fields,
                            Платформа: this.options.collectType,
                            "Название поста": posts.find(
                              (e) => e.postId === comment?.postId
                            )?.name!,
                          },
                          recordId: watchableComments.data.records.find(
                            (e) => e.fields["Текст"] === comment.content
                          )!.recordId!,
                        },
                      ]),
                ],
                fieldKey: "name",
              }),
              { fieldKey: "name", records: [] }
            );

          const createdComments = comments
            .filter((comment) => {
              return (
                comment &&
                !watchableComments.data.records
                  .map((e) => e.fields["Текст"])
                  .includes(comment?.content)
              );
            })
            .reduce<{ fieldKey: "name"; records: WatchableComment[] }>(
              (acc, cur) => ({
                records: [
                  ...acc.records,
                  {
                    fields: {
                      ...parser(cur!).fields,
                      Платформа: this.options.collectType,
                      "Название поста": posts.find(
                        (e) => e.postId === cur?.postId
                      )?.name!,
                    },
                  },
                ],
                fieldKey: "name",
              }),
              { fieldKey: "name", records: [] }
            );

          await Promise.allSettled([
            fetch(
              // TODO: rm
              `https://tables.mws.ru/fusion/v1/datasheets/dstH8ioXFi7aHHyiUe/records?viewId=viwN17cmf3JQe&fieldKey=name`,
              {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${this.options.apiKey || ""}`,
                },
                body: JSON.stringify(updatedComments),
              }
            ),
            fetch(
              // TODO: rm
              `https://tables.mws.ru/fusion/v1/datasheets/dstH8ioXFi7aHHyiUe/records?viewId=viwN17cmf3JQe&fieldKey=name`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${this.options.apiKey || ""}`,
                },
                body: JSON.stringify(createdComments),
              }
            ),
          ]);
        }
      }

      const [_, postSaveParser] = this.options.savePostPath;

      const updatedPosts = posts
        .filter((post) => {
          return watchablePosts.data.records
            .map((e) => e.fields["Название"] + "|" + e.fields["Платформа"])
            .includes(post.name + "|" + this.options.collectType);
        })
        .reduce<{ fieldKey: "name"; records: WatchablePost[] }>(
          (acc, post) => ({
            records: [
              ...acc.records,
              {
                fields: {
                  ...postSaveParser(post).fields,
                  Платформа: this.options.collectType,
                },
                recordId: watchablePosts.data.records.find(
                  (e) => e.fields["Название"] === post.name
                )?.recordId,
              },
            ],
            fieldKey: "name",
          }),
          { fieldKey: "name", records: [] }
        );

      const createdPosts = posts
        .filter((post) => {
          return !watchablePosts.data.records
            .map((e) => e.fields["Название"] + "|" + e.fields["Платформа"])
            .includes(post.name + "|" + this.options.collectType);
        })
        .reduce<{ fieldKey: "name"; records: WatchablePost[] }>(
          (acc, cur) => ({
            records: [
              ...acc.records,
              {
                fields: {
                  ...postSaveParser(cur).fields,
                  Платформа: this.options.collectType,
                },
              },
            ],
            fieldKey: "name",
          }),
          { fieldKey: "name", records: [] }
        );

      return await Promise.allSettled([
        fetch(
          // TODO: rm
          `https://tables.mws.ru/fusion/v1/datasheets/${MWS_TABLE_ID}/records?viewId=viwGMvDqZHFgN&fieldKey=name`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.options.apiKey || ""}`,
            },
            body: JSON.stringify(updatedPosts),
          }
        ),
        fetch(
          // TODO: rm
          `https://tables.mws.ru/fusion/v1/datasheets/${MWS_TABLE_ID}/records?viewId=viwGMvDqZHFgN&fieldKey=name`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.options.apiKey || ""}`,
            },
            body: JSON.stringify(createdPosts),
          }
        ),
      ]);
    } catch (error) {
      console.error("Error in execute method:", error);
    }
  }

  private getWatchableComments =
    async (): Promise<WatchableCommentResponse> => {
      const allRecords: WatchablePostsRecord[] = [];
      let pageNum = 1;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const url = new URL(
          // TODO: rm
          `https://tables.mws.ru/fusion/v1/datasheets/dstH8ioXFi7aHHyiUe/records`
        );
        url.searchParams.set("viewId", "viwN17cmf3JQe");
        url.searchParams.set("fieldKey", "name");
        url.searchParams.set("pageNum", pageNum.toString());
        url.searchParams.set("pageSize", pageSize.toString());

        try {
          const res = await fetch(url.toString(), {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.options.apiKey || ""}`,
            },
          });

          if (!res.ok) {
            console.log(await res.text());
            throw new Error(`HTTP error! status: ${res.status}`);
          }

          const data = (await res.json()) as WatchablePostsResponse;

          if ((data.data.records.length as number) === 0) {
            hasMore = false;
          } else {
            allRecords.push(...data.data.records);
            pageNum++;
          }

          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error) {
          console.error(
            `Error fetching watchable posts (page ${pageNum}):`,
            error
          );
          throw error;
        }
      }

      return {
        code: 200,
        success: true,
        message: "All posts fetched successfully",
        data: {
          total: allRecords.length,
          pageNum: 1,
          pageSize: allRecords.length,
          records: allRecords as any,
        },
      };
    };

  private getWatchablePosts = async (): Promise<WatchablePostsResponse> => {
    const allRecords: WatchablePostsRecord[] = [];
    let pageNum = 1;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const url = new URL(
        // TODO: rm
        `https://tables.mws.ru/fusion/v1/datasheets/${MWS_TABLE_ID}/records`
      );
      url.searchParams.set("viewId", MWS_POSTS_TABLE);
      url.searchParams.set("fieldKey", "name");
      url.searchParams.set("pageNum", pageNum.toString());
      url.searchParams.set("pageSize", pageSize.toString());

      try {
        const res = await fetch(url.toString(), {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.options.apiKey || ""}`,
          },
        });

        if (!res.ok) {
          console.log(await res.text());
          throw new Error(`HTTP error! status: ${res.status}`);
        }

        const data = (await res.json()) as WatchablePostsResponse;

        if ((data.data.records.length as number) === 0) {
          hasMore = false;
        } else {
          allRecords.push(...data.data.records);
          pageNum++;
        }

        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        console.error(
          `Error fetching watchable posts (page ${pageNum}):`,
          error
        );
        throw error;
      }
    }

    return {
      code: 200,
      success: true,
      message: "All posts fetched successfully",
      data: {
        total: allRecords.length,
        pageNum: 1,
        pageSize: allRecords.length,
        records: allRecords as any,
      },
    };
  };
}

const habrSource = new Source({
  baseUrl: "https://habr.com/kek/v2/",
  pathCollectPaths: [
    [
      `articles/?user=${HABR_COLLECT_USER}&fl=ru&hl=ru&page=1&perPage=20`,
      `articles/?user=${HABR_COLLECT_USER}&news=true&fl=ru&hl=ru&page=1&perPage=20`,
    ],
    (res) => {
      return res.publicationIds as string[];
    },
  ],
  collectPostBasePath: [
    "articles/",
    (res) => {
      const data = res as HabrPostSourceResponse;

      return {
        postId: data.id,
        name: data.titleHtml,
        likes: data.statistics.votesCountPlus,
        dislikes: data.statistics.votesCountMinus,
        commentsCount: data.statistics.commentsCount,
        reach: data.statistics.reach,
        readers: data.statistics.readers,
        readingCount: data.statistics.readingCount,
        favoritesCount: data.statistics.favoritesCount,
        tags: data.tags.map((tag) => tag.titleHtml),
      };
    },
  ],
  collectCommentsBasePath: [
    "articles/{id}/comments/?hl=ru",
    (res) => {
      const data = res as HabrCommentSourceResponse;

      return Object.entries(data.comments).map(
        ([_, comment]): Partial<Comment> => ({
          content: comment.message,
          score: comment.score,
        })
      );
    },
  ],
});

const habrCollector = new Collector(habrSource, {
  collectType: "Хабр",
  baseUrl: `https://tables.mws.ru/fusion/v1/datasheets/${MWS_TABLE_ID}/`,
  savePostPath: [
    `records?viewId=${MWS_POSTS_TABLE}&fieldKey=name`,
    (post: Post) => {
      return {
        fields: {
          Название: post.name,
          Просмотры: post.readingCount,
          Проскроллившие: post.reach,
          Прочитавшие: post.readers,
          Лайки: post.likes,
          "Избранное (если применимо)": post.favoritesCount,
          Дизлайки: post.dislikes,
          Комментарии: post.commentsCount,
          Теги: post.tags,
        },
      };
    },
  ],
  saveCommentsPath: [
    `123`,
    (comment) => {
      return {
        fields: {
          Текст: comment.content!,
          "Лайки-Дизлайки": comment.score!,
          Тональность:
            comment.sentiment === "positive"
              ? "Позитивная"
              : comment.sentiment === "negative"
              ? "Негативная"
              : "Нейтральная",
          Уверенность: comment.confidence,
        },
      };
    },
  ],
  apiKey: MWS_TABLES_API_KEY,
});

const vcCollector = new Collector(
  new Source({
    baseUrl: "https://api.vc.ru/v2.10/",
    pathCollectPaths: [
      [`timeline?markdown=true&sorting=new&subsitesIds=${VC_COLLECT_USER}`],
      (res) => {
        return (res.result as { items: { data: { id: string } }[] }).items.map(
          (item) => item.data.id
        ) as string[];
      },
    ],
    collectPostBasePath: [
      "content?markdown=false&id=",
      (res) => {
        const data = res as VcPostSourceResponse;

        return {
          postId: `${data.result.id}`,
          name: data.result.title,
          likes: data.result.reactions.counters.reduce(
            (acc, cur) => acc + ([1, 2].includes(cur.id) ? cur.count : 0),
            0
          ),
          dislikes: data.result.reactions.counters.reduce(
            (acc, cur) => acc + ([4, 5].includes(cur.id) ? cur.count : 0),
            0
          ),
          commentsCount: data.result.counters.comments,
          reach: data.result.counters.views,
          readers: data.result.counters.hits,
          readingCount: data.result.counters.views,
          favoritesCount: data.result.counters.favorites,
          tags: [],
        };
      },
    ],
  }),
  {
    baseUrl: `https://tables.mws.ru/fusion/v1/datasheets/${MWS_TABLE_ID}/`,
    collectType: "VC",
    savePostPath: [
      `records?viewId=${MWS_POSTS_TABLE}&fieldKey=name`,
      (post: Post) => {
        return {
          fields: {
            Название: post.name,
            Просмотры: post.readingCount,
            Проскроллившие: post.reach,
            Прочитавшие: post.readers,
            Лайки: post.likes,
            "Избранное (если применимо)": post.favoritesCount,
            Дизлайки: post.dislikes,
            Комментарии: post.commentsCount,
            Теги: post.tags,
          },
        };
      },
    ],
    apiKey: MWS_TABLES_API_KEY,
  }
);

const tgCollector = new Collector(new TgSource(), {
  collectType: "Телеграм",
  baseUrl: `https://tables.mws.ru/fusion/v1/datasheets/${MWS_TABLE_ID}/`,
  savePostPath: [
    `records?viewId=${MWS_POSTS_TABLE}&fieldKey=name`,
    (post: Post) => {
      return {
        fields: {
          Название: post.name,
          Просмотры: post.readingCount,
          Проскроллившие: post.reach,
          Прочитавшие: post.readers,
          Лайки: post.likes,
          "Избранное (если применимо)": post.favoritesCount,
          Дизлайки: post.dislikes,
          Комментарии: post.commentsCount,
          Теги: post.tags,
        },
      };
    },
  ],
  apiKey: MWS_TABLES_API_KEY,
});

const collectors = [habrCollector, tgCollector, vcCollector];

const collect = async (collectors: Collector[]) => {
  for (const collector of collectors) {
    const posts = await collector.execute();
    const updatedPosts = posts?.[0];
    const createdPosts = posts?.[1];
    console.log(
      "Updated posts:",
      updatedPosts?.status === "fulfilled" && (await updatedPosts?.value.json())
    );
    console.log(
      "Created posts:",
      createdPosts?.status === "fulfilled" && (await createdPosts?.value.json())
    );
  }
};

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.post("/collect", async (req, res) => {
  try {
    await collect(
      collectors.filter((el) =>
        req.body.platforms.includes(el.options.collectType)
      )
    );

    return res.json({ message: "Всё хорошо" });
  } catch (e) {
    console.error(e);
    return res.json({
      message:
        "Походу походу что-то не то, я уже отослал создателю всё что можно ;-;",
    });
  }
});

const job = new CronJob("0 * * * *", async () => {
  console.log("Начало сбора");
  try {
    await collect(collectors);
    console.log("Сбор завершён успешно");
  } catch (error) {
    console.error("Сбор завершён с ошибкой:", error);
  }
});

app.listen(3000, async () => {
  job.start();
  console.log("Запустились");
});
