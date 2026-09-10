export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      candidate_sets: {
        Row: {
          active_member_count: number
          eligible_count: number
          generated_at: string
          id: string
          input_hash: string
          input_version: number
          plan_id: string
          responded_count: number
          revision: number
          scoring_version: number
          starts_considered: number
        }
        Insert: {
          active_member_count: number
          eligible_count: number
          generated_at?: string
          id?: string
          input_hash: string
          input_version: number
          plan_id: string
          responded_count: number
          revision: number
          scoring_version: number
          starts_considered: number
        }
        Update: {
          active_member_count?: number
          eligible_count?: number
          generated_at?: string
          id?: string
          input_hash?: string
          input_version?: number
          plan_id?: string
          responded_count?: number
          revision?: number
          scoring_version?: number
          starts_considered?: number
        }
        Relationships: [
          {
            foreignKeyName: "candidate_sets_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plan_interest_counts"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "candidate_sets_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      candidates: {
        Row: {
          available_user_ids: string[]
          candidate_set_id: string
          ends_at: string
          explanation_code: string
          explanation_count: number
          explicit_count: number
          flexible_count: number
          id: string
          is_near_miss: boolean
          near_miss_reason: Json | null
          rank: number
          starts_at: string
        }
        Insert: {
          available_user_ids: string[]
          candidate_set_id: string
          ends_at: string
          explanation_code: string
          explanation_count: number
          explicit_count: number
          flexible_count: number
          id?: string
          is_near_miss: boolean
          near_miss_reason?: Json | null
          rank: number
          starts_at: string
        }
        Update: {
          available_user_ids?: string[]
          candidate_set_id?: string
          ends_at?: string
          explanation_code?: string
          explanation_count?: number
          explicit_count?: number
          flexible_count?: number
          id?: string
          is_near_miss?: boolean
          near_miss_reason?: Json | null
          rank?: number
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidates_candidate_set_id_fkey"
            columns: ["candidate_set_id"]
            isOneToOne: false
            referencedRelation: "candidate_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      circle_invites: {
        Row: {
          circle_id: string
          created_at: string
          created_by: string
          id: string
          revoked_at: string | null
          secret_hash: string
          updated_at: string
          use_count: number
        }
        Insert: {
          circle_id: string
          created_at?: string
          created_by: string
          id?: string
          revoked_at?: string | null
          secret_hash: string
          updated_at?: string
          use_count?: number
        }
        Update: {
          circle_id?: string
          created_at?: string
          created_by?: string
          id?: string
          revoked_at?: string | null
          secret_hash?: string
          updated_at?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "circle_invites_circle_id_fkey"
            columns: ["circle_id"]
            isOneToOne: false
            referencedRelation: "circles"
            referencedColumns: ["id"]
          },
        ]
      }
      circle_members: {
        Row: {
          circle_id: string
          created_at: string
          display_name_snapshot: string
          joined_at: string
          muted_all: boolean
          muted_quiet_asks: boolean
          role: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          circle_id: string
          created_at?: string
          display_name_snapshot: string
          joined_at?: string
          muted_all?: boolean
          muted_quiet_asks?: boolean
          role?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          circle_id?: string
          created_at?: string
          display_name_snapshot?: string
          joined_at?: string
          muted_all?: boolean
          muted_quiet_asks?: boolean
          role?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "circle_members_circle_id_fkey"
            columns: ["circle_id"]
            isOneToOne: false
            referencedRelation: "circles"
            referencedColumns: ["id"]
          },
        ]
      }
      circles: {
        Row: {
          cadence: string
          cadence_snoozed_until: string | null
          color: string
          created_at: string
          creation_key: string
          default_area: string | null
          default_duration_minutes: number
          default_quorum: number | null
          id: string
          last_met_at: string | null
          name: string
          nudge_policy: string | null
          owner_user_id: string
          short_code: string
          status: string
          time_zone: string
          updated_at: string
        }
        Insert: {
          cadence?: string
          cadence_snoozed_until?: string | null
          color: string
          created_at?: string
          creation_key: string
          default_area?: string | null
          default_duration_minutes?: number
          default_quorum?: number | null
          id?: string
          last_met_at?: string | null
          name: string
          nudge_policy?: string | null
          owner_user_id: string
          short_code: string
          status?: string
          time_zone: string
          updated_at?: string
        }
        Update: {
          cadence?: string
          cadence_snoozed_until?: string | null
          color?: string
          created_at?: string
          creation_key?: string
          default_area?: string | null
          default_duration_minutes?: number
          default_quorum?: number | null
          id?: string
          last_met_at?: string | null
          name?: string
          nudge_policy?: string | null
          owner_user_id?: string
          short_code?: string
          status?: string
          time_zone?: string
          updated_at?: string
        }
        Relationships: []
      }
      plan_participants: {
        Row: {
          joined_at: string
          plan_id: string
          revision: number
          user_id: string
        }
        Insert: {
          joined_at?: string
          plan_id: string
          revision: number
          user_id: string
        }
        Update: {
          joined_at?: string
          plan_id?: string
          revision?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_participants_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plan_interest_counts"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "plan_participants_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_required_members: {
        Row: {
          plan_id: string
          revision: number
          user_id: string
        }
        Insert: {
          plan_id: string
          revision: number
          user_id: string
        }
        Update: {
          plan_id?: string
          revision?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_required_members_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plan_interest_counts"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "plan_required_members_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_responses: {
        Row: {
          created_at: string
          id: string
          plan_id: string
          revision: number
          status: string
          submitted_at: string
          updated_at: string
          used_calendar_overlay: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          plan_id: string
          revision: number
          status: string
          submitted_at?: string
          updated_at?: string
          used_calendar_overlay?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          plan_id?: string
          revision?: number
          status?: string
          submitted_at?: string
          updated_at?: string
          used_calendar_overlay?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_responses_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plan_interest_counts"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "plan_responses_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          cancel_note: string | null
          category: string
          circle_id: string
          created_at: string
          daily_end_local: number
          daily_start_local: number
          duration_minutes: number
          id: string
          input_version: number
          mode: string
          organiser_user_id: string | null
          quiet_expires_at: string | null
          quiet_threshold: number | null
          quorum: number
          response_deadline: string
          revision: number
          scoring_version: number
          short_code: string
          state: string
          time_zone: string
          title: string
          updated_at: string
          window_end: string
          window_start: string
        }
        Insert: {
          cancel_note?: string | null
          category?: string
          circle_id: string
          created_at?: string
          daily_end_local: number
          daily_start_local: number
          duration_minutes: number
          id?: string
          input_version?: number
          mode: string
          organiser_user_id?: string | null
          quiet_expires_at?: string | null
          quiet_threshold?: number | null
          quorum: number
          response_deadline: string
          revision?: number
          scoring_version?: number
          short_code: string
          state?: string
          time_zone: string
          title: string
          updated_at?: string
          window_end: string
          window_start: string
        }
        Update: {
          cancel_note?: string | null
          category?: string
          circle_id?: string
          created_at?: string
          daily_end_local?: number
          daily_start_local?: number
          duration_minutes?: number
          id?: string
          input_version?: number
          mode?: string
          organiser_user_id?: string | null
          quiet_expires_at?: string | null
          quiet_threshold?: number | null
          quorum?: number
          response_deadline?: string
          revision?: number
          scoring_version?: number
          short_code?: string
          state?: string
          time_zone?: string
          title?: string
          updated_at?: string
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "plans_circle_id_fkey"
            columns: ["circle_id"]
            isOneToOne: false
            referencedRelation: "circles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          app_installed_at: string | null
          created_at: string
          display_name: string
          is_permanent: boolean
          time_zone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_installed_at?: string | null
          created_at?: string
          display_name: string
          is_permanent?: boolean
          time_zone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_installed_at?: string | null
          created_at?: string
          display_name?: string
          is_permanent?: boolean
          time_zone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      willing_windows: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          response_id: string
          starts_at: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          response_id: string
          starts_at: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          response_id?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "willing_windows_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "plan_responses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      member_profiles: {
        Row: {
          display_name: string | null
          user_id: string | null
        }
        Insert: {
          display_name?: string | null
          user_id?: string | null
        }
        Update: {
          display_name?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      plan_interest_counts: {
        Row: {
          keen_count: number | null
          plan_id: string | null
        }
        Relationships: []
      }
      response_summaries: {
        Row: {
          plan_id: string | null
          revision: number | null
          status: string | null
          submitted_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_responses_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plan_interest_counts"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "plan_responses_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      auth_is_member: { Args: { circle_id: string }; Returns: boolean }
      auth_is_owner: { Args: { circle_id: string }; Returns: boolean }
      auth_is_permanent: { Args: never; Returns: boolean }
      canonical_display_name: { Args: { value: string }; Returns: string }
      create_circle: {
        Args: {
          cadence?: string
          color: string
          idempotency_key: string
          name: string
          time_zone: string
        }
        Returns: {
          cadence: string
          cadence_snoozed_until: string | null
          color: string
          created_at: string
          creation_key: string
          default_area: string | null
          default_duration_minutes: number
          default_quorum: number | null
          id: string
          last_met_at: string | null
          name: string
          nudge_policy: string | null
          owner_user_id: string
          short_code: string
          status: string
          time_zone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "circles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      member_cap: { Args: never; Returns: number }
      plan_last_possible_start: {
        Args: {
          daily_end_local: number
          duration_minutes: number
          time_zone: string
          window_end: string
        }
        Returns: string
      }
      replace_response: {
        Args: {
          p_plan_id: string
          p_revision: number
          p_status: string
          p_used_calendar_overlay?: boolean
          p_windows?: Json
        }
        Returns: {
          created_at: string
          id: string
          plan_id: string
          revision: number
          status: string
          submitted_at: string
          updated_at: string
          used_calendar_overlay: boolean
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "plan_responses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

