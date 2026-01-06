import zod  from 'zod';

export const EnvVarsSchema = zod.object({
  PORT: zod.coerce.number().default(6000),
  UPSTASH_REDIS_REST_URL: zod.url(),
  UPSTASH_REDIS_REST_TOKEN: zod.string(),
});

export const envVars = EnvVarsSchema.parse(process.env);