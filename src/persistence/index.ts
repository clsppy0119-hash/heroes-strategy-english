export {
  LOCAL_PLAYER_ID,
  SAVE_KEY_PREFIX,
  configureRepository,
  createLocalStorageRepository,
  createMemoryRepository,
  gameRepository,
  saveKey,
  type GameRepository,
} from './repository';

export {
  REVIEW_KEY_PREFIX,
  configureReviewRepository,
  createLocalStorageReviewRepository,
  createMemoryReviewRepository,
  readReviewBook,
  reviewKey,
  reviewRepository,
  type ReviewRepository,
} from './review-repository';
