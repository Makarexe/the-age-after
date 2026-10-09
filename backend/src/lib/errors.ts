/**
 * Every API error uses the Yggdrasil shape `{error, errorMessage}`, so authlib-injector and
 * the launcher can read it the same way.
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly error: string,
    message: string,
  ) {
    super(message);
  }
}

export const forbidden = (message: string) => new ApiError(403, 'ForbiddenOperationException', message);
export const badRequest = (message: string) => new ApiError(400, 'IllegalArgumentException', message);
export const unauthorized = (message = 'Нужно войти заново.') => new ApiError(401, 'Unauthorized', message);
export const notFound = (message = 'Не найдено.') => new ApiError(404, 'NotFound', message);
export const conflict = (message: string) => new ApiError(409, 'Conflict', message);
export const tooManyRequests = () =>
  new ApiError(429, 'TooManyRequestsException', 'Слишком много попыток. Подождите немного и попробуйте снова.');

export const INVALID_TOKEN = 'Invalid token.';
export const INVALID_CREDENTIALS = 'Неверный ник, почта или пароль.';
