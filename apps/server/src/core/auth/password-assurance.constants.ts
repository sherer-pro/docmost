// A fixed bcrypt hash keeps unknown-account login work comparable to a real
// password check without creating state or exposing whether an account exists.
export const DUMMY_PASSWORD_HASH =
  '$2b$12$4341LgD7Vh9.msBmrN7oReIXvWaoQ05tIa4BaTYqcQNBakm9kSVXK';
