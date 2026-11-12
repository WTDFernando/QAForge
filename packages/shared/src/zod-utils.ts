import { z } from 'zod';

/**
 * Like `.partial()`, but also drops defaults. In Zod 4 a defaulted field inside `.partial()`
 * still fills in its default, so a PATCH with only `{ title }` would reset every other field.
 */
export function patchOf<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    const inner =
      field instanceof z.ZodDefault ? (field.unwrap() as z.ZodType) : (field as z.ZodType);
    shape[key] = inner.optional();
  }
  return z.object(shape) as unknown as z.ZodObject<{
    [K in keyof T]: z.ZodOptional<T[K] extends z.ZodDefault<infer I extends z.ZodType> ? I : T[K]>;
  }>;
}
