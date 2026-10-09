import type { z } from 'zod';
import { badRequest } from './errors.js';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) throw badRequest(result.error.issues[0]?.message ?? 'Неверный запрос.');
  return result.data;
}
