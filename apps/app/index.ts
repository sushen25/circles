/**
 * The app's entry point: one thing, then the router.
 *
 * An invite link carries its secret in the URL fragment, and expo-router reads
 * the URL — fragment included — the moment its module is evaluated, then keeps
 * writing it back into the address bar. So the secret is taken out here, in a
 * module evaluated before `expo-router/entry` is (imports run in order), and
 * the router starts on a plain `/join` (S1-24, `captureInviteFragment`).
 *
 * The zod import comes before it only because it must come before any schema
 * is built (SUS-119); it reads no URL.
 */
import './src/platform/zod';
import './src/data/membership/capture';
import 'expo-router/entry';
