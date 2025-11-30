declare global {
  type WatchablePost = {
    fields: Partial<{
      Название: string;
      Платформа: string;
      Просмотры: number;
      Readers: number;
      Reach: number;
      Лайки: number;
      "Избранное (если применимо)": number;
      Дизлайки: number;
      Комментарии: number;
      Теги: string[];
    }>;
  };

  type Recordable = {
    recordId: string;
  };

  type WatchablePostsRecord = Recordable & {
    fields: WatchablePost["fields"];
  };

  type WatchableComment = {
    fields: Partial<{
      "Название поста": string;
      Платформа: string;
      Текст: string;
      "Лайки-Дизлайки": number;
      Тональность: "Позитивная" | "Негативная" | "Нейтральная";
      Уверенность: number;
    }>;
  };

  type WatchableCommentRecord = Recordable & {
    fields: WatchableComment["fields"];
  };

  type WatchableResponse<T extends Recordable> = {
    code: number;
    success: boolean;
    message: string;
    data: {
      total: number;
      pageNum: number;
      pageSize: number;
      records: T[];
    };
  };

  type WatchablePostsResponse = WatchableResponse<WatchablePostsRecord>;
  type WatchableCommentResponse = WatchableResponse<WatchableCommentRecord>;

  type Post = {
    postId: string;
    name: string;
    likes: number;
    dislikes: number;
    commentsCount: number;
    // Уникальные пользователи, открывшие публикацию или увидевшие еe в ленте
    reach: number;
    // Уникальные пользователи, открывшие публикацию
    readers: number;
    // Сколько всего раз просмотрели, не уникальных пользователей
    readingCount: number;
    favoritesCount: number;
    tags: string[];
  };

  type Comment = Partial<{
    postId: string;
    content: string;
    score: number;
  }>;

  type SourceOptions = {
    baseUrl: string;
    apiKey?: string;
    pathCollectPaths: [string[], (res: Record<string, unknown>) => string[]];
    collectPostBasePath: [string, (res: Record<string, unknown>) => Post];
    collectCommentsBasePath?: [
      string,
      (res: Record<string, unknown>) => Comment[]
    ];
  };

  type HabrPostSourceResponse = {
    id: string;
    statistics: {
      commentsCount: number;
      favoritesCount: number;
      readingCount: number;
      score: number;
      votesCount: number;
      votesCountPlus: number;
      votesCountMinus: number;
      reach: number;
      readers: number;
    };
    titleHtml: string;
    tags: [
      {
        titleHtml: string;
      }
    ];
  };

  type HabrCommentSourceResponse = {
    comments: {
      [key: string]: {
        id: string;
        parentId: string | null;
        level: number;
        timePublished: string;
        timeChanged: string | null;
        isSuspended: boolean;
        status: string;
        score: number;
        votesCount: number;
        message: string;
        editorVersion: number;
        author: {
          id: string;
          alias: string;
          fullname: string | null;
          avatarUrl: string | null;
          speciality: string | null;
        };
        isAuthor: boolean;
        isPostAuthor: boolean;
        isNew: boolean;
        isFavorite: boolean;
        isCanEdit: boolean;
        timeEditAllowedTill: string | null;
        children: string[];
        vote: {
          value: unknown;
          isCanVote: boolean;
        };
        votePlus: {
          canVote: boolean;
          isChargeEnough: boolean;
          isKarmaEnough: boolean;
          isVotingOver: boolean;
          isPublicationLimitEnough: boolean;
        };
        voteMinus: {
          canVote: boolean;
          isChargeEnough: boolean;
          isKarmaEnough: boolean;
          isVotingOver: boolean;
          isPublicationLimitEnough: boolean;
        };
        isPinned: boolean;
        isPublicationAuthor: boolean;
      };
    };
  };

  type VcPostSourceResponse = {
    message: string;
    result: {
      id: number;
      subsiteId: number;
      title: string;
      counters: {
        comments: number;
        favorites: number;
        reposts: number;
        views: number;
        hits: number;
        reads: null;
        online: number;
      };
      hitsCount: number;
      url: string;
      reactions: {
        counters: Array<{
          id: number;
          count: number;
        }>;
        reactionId: number;
      };
      keywords: any[];
      robotsTag: null;
      categories: number[];
    };
  };
}

export {};
