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
    }
    Functions: {
      auth_is_member: { Args: { circle_id: string }; Returns: boolean }
      auth_is_owner: { Args: { circle_id: string }; Returns: boolean }
      auth_is_permanent: { Args: never; Returns: boolean }
      create_circle: {
        Args: {
          cadence?: string
          color: string
          name: string
          time_zone: string
        }
        Returns: {
          cadence: string
          cadence_snoozed_until: string | null
          color: string
          created_at: string
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

