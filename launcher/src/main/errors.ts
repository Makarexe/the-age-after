/** An error whose message can be shown to the player as is. */
export class UserError extends Error {
  constructor(
    message: string,
    public readonly code?: 'session_expired',
  ) {
    super(message);
  }
}

export const sessionExpired = () => new UserError('Сессия истекла, войдите снова.', 'session_expired');
