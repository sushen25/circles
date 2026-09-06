/**
 * PLACEHOLDER — overwritten by `pnpm gen:types` once the Supabase schema exists
 * (S0-06). Never write a table type by hand.
 *
 * It is committed so that anything importing `Database` compiles before the
 * local stack exists, and so the first real generation shows up as a diff
 * rather than a new file.
 */
export type Database = {
  public: { Tables: Record<string, never>; Views: Record<string, never> };
};

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T];
