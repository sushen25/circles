import { z } from 'zod';

import { Mutation, Accepted } from './shared.js';

/** `register-push-device` — Upsert an Expo push token for the signed-in user. */
export const RegisterPushDeviceRequest = Mutation.extend({
  expo_push_token: z.string().min(1).max(256),
  platform: z.enum(['ios', 'android']),
});
export type RegisterPushDeviceRequest = z.infer<typeof RegisterPushDeviceRequest>;

export const RegisterPushDeviceResponse = Accepted;
export type RegisterPushDeviceResponse = z.infer<typeof RegisterPushDeviceResponse>;
