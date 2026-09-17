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
      attendance: {
        Row: {
          confirmation_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          confirmation_id: string
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          confirmation_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_confirmation_id_fkey"
            columns: ["confirmation_id"]
            isOneToOne: false
            referencedRelation: "meetup_confirmations"
            referencedColumns: ["id"]
          },
        ]
      }
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
      meetup_confirmations: {
        Row: {
          available_user_ids: string[]
          candidate_id: string
          chased_answer: string | null
          confirmed_at: string
          confirmed_by: string
          created_at: string
          ends_at: string
          id: string
          note: string | null
          place_name: string | null
          place_url: string | null
          plan_id: string
          revision: number
          starts_at: string
          status: string
          superseded_at: string | null
          superseded_reason: string | null
          updated_at: string
        }
        Insert: {
          available_user_ids: string[]
          candidate_id: string
          chased_answer?: string | null
          confirmed_at?: string
          confirmed_by: string
          created_at?: string
          ends_at: string
          id?: string
          note?: string | null
          place_name?: string | null
          place_url?: string | null
          plan_id: string
          revision: number
          starts_at: string
          status?: string
          superseded_at?: string | null
          superseded_reason?: string | null
          updated_at?: string
        }
        Update: {
          available_user_ids?: string[]
          candidate_id?: string
          chased_answer?: string | null
          confirmed_at?: string
          confirmed_by?: string
          created_at?: string
          ends_at?: string
          id?: string
          note?: string | null
          place_name?: string | null
          place_url?: string | null
          plan_id?: string
          revision?: number
          starts_at?: string
          status?: string
          superseded_at?: string | null
          superseded_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetup_confirmations_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plan_interest_counts"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "meetup_confirmations_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      member_dayparts: {
        Row: {
          circle_id: string
          computed_at: string
          summary: Json
          user_id: string
        }
        Insert: {
          circle_id: string
          computed_at?: string
          summary: Json
          user_id: string
        }
        Update: {
          circle_id?: string
          computed_at?: string
          summary?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_dayparts_circle_id_user_id_fkey"
            columns: ["circle_id", "user_id"]
            isOneToOne: true
            referencedRelation: "circle_members"
            referencedColumns: ["circle_id", "user_id"]
          },
        ]
      }
      nudge_states: {
        Row: {
          answer: string | null
          created_at: string
          id: string
          moment: string
          plan_id: string | null
          shown_at: string
          snoozed_until: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          answer?: string | null
          created_at?: string
          id?: string
          moment: string
          plan_id?: string | null
          shown_at?: string
          snoozed_until?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          answer?: string | null
          created_at?: string
          id?: string
          moment?: string
          plan_id?: string | null
          shown_at?: string
          snoozed_until?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nudge_states_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plan_interest_counts"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "nudge_states_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      outcome_reports: {
        Row: {
          confirmation_id: string
          id: string
          moved_outside: boolean | null
          note: string | null
          outcome: string
          reported_at: string
          reported_by: string
        }
        Insert: {
          confirmation_id: string
          id?: string
          moved_outside?: boolean | null
          note?: string | null
          outcome: string
          reported_at?: string
          reported_by: string
        }
        Update: {
          confirmation_id?: string
          id?: string
          moved_outside?: boolean | null
          note?: string | null
          outcome?: string
          reported_at?: string
          reported_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "outcome_reports_confirmation_id_fkey"
            columns: ["confirmation_id"]
            isOneToOne: false
            referencedRelation: "meetup_confirmations"
            referencedColumns: ["id"]
          },
        ]
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
      begin_request: {
        Args: {
          p_fingerprint: string
          p_function: string
          p_key: string
          p_user: string
        }
        Returns: {
          response_body: Json
          response_status: number
          state: string
        }[]
      }
      cancel_plan: {
        Args: { p_note?: string; p_plan_id: string }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      candidate_summary: {
        Args: {
          p_stored: boolean
          plan: Database["public"]["Tables"]["plans"]["Row"]
        }
        Returns: Json
      }
      canonical_display_name: { Args: { value: string }; Returns: string }
      claim_identity: {
        Args: {
          p_anonymous_user_id: string
          p_moment: string
          p_user_id: string
        }
        Returns: {
          duplicates_removed: number
          merged_memberships: number
        }[]
      }
      confirm_meetup: {
        Args: {
          p_candidate_id: string
          p_chased_answer: string
          p_expected_set_id: string
          p_note?: string
          p_place_name?: string
          p_place_url?: string
          p_plan_id: string
        }
        Returns: {
          available_user_ids: string[]
          candidate_id: string
          chased_answer: string | null
          confirmed_at: string
          confirmed_by: string
          created_at: string
          ends_at: string
          id: string
          note: string | null
          place_name: string | null
          place_url: string | null
          plan_id: string
          revision: number
          starts_at: string
          status: string
          superseded_at: string | null
          superseded_reason: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "meetup_confirmations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirmation_evidence: {
        Args: { p_confirmation_id: string }
        Returns: Json
      }
      create_circle: {
        Args: {
          cadence?: string
          color: string
          idempotency_key: string
          invite_secret_hash?: string
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
      create_plan: {
        Args: {
          p_category: string
          p_circle_id: string
          p_daily_end_local: number
          p_daily_start_local: number
          p_duration_minutes: number
          p_quorum: number
          p_required_member_ids?: string[]
          p_response_deadline: string
          p_title: string
          p_window_end: string
          p_window_start: string
        }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      email_preferences: {
        Args: { p_action: string; p_plan_id?: string; p_token_hash: string }
        Returns: Json
      }
      engine_input: { Args: { p_plan_id: string }; Returns: Json }
      finish_request: {
        Args: {
          p_body: Json
          p_function: string
          p_key: string
          p_status: number
          p_user: string
        }
        Returns: undefined
      }
      founder_summary: { Args: never; Returns: Json }
      guest_members_for_reattach: {
        Args: { p_short_code: string }
        Returns: {
          circle_id: string
          display_name: string
          member_user_id: string
        }[]
      }
      invite_preview: {
        Args: { p_secret_hash: string }
        Returns: {
          circle_name: string
          inviter_name: string
          member_initials: string[]
        }[]
      }
      issue_invite: {
        Args: { p_circle_id: string; p_secret_hash: string }
        Returns: {
          circle_id: string
          created_at: string
          created_by: string
          id: string
          revoked_at: string | null
          secret_hash: string
          updated_at: string
          use_count: number
        }
        SetofOptions: {
          from: "*"
          to: "circle_invites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      issue_reentry_token: {
        Args: { p_circle_id: string; p_token_hash: string; p_user_id: string }
        Returns: string
      }
      issue_verification_token: {
        Args: { p_contact_id: string; p_token_hash: string }
        Returns: string
      }
      member_cap: { Args: never; Returns: number }
      plan_candidate_summary: { Args: { p_plan_id: string }; Returns: Json }
      plan_last_possible_start: {
        Args: {
          daily_end_local: number
          duration_minutes: number
          time_zone: string
          window_end: string
        }
        Returns: string
      }
      preview_for_code: {
        Args: { p_code: string; p_kind: string }
        Returns: string
      }
      reask_audience: {
        Args: { p_plan_id: string }
        Returns: {
          has_responded: boolean
          member_user_id: string
        }[]
      }
      reattach_member: {
        Args: {
          p_circle_id?: string
          p_reentry_token_hash?: string
          p_target_user_id?: string
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
      record_events: { Args: { p_rows: Json }; Returns: number }
      redeem_invite: {
        Args: { p_display_name: string; p_secret_hash: string }
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
      release_request: {
        Args: { p_function: string; p_key: string; p_user: string }
        Returns: undefined
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
      report_outcome: {
        Args: {
          p_confirmation_id: string
          p_moved_outside?: boolean
          p_note?: string
          p_outcome: string
        }
        Returns: {
          confirmation_id: string
          id: string
          moved_outside: boolean | null
          note: string | null
          outcome: string
          reported_at: string
          reported_by: string
        }
        SetofOptions: {
          from: "*"
          to: "outcome_reports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_email_updates: {
        Args: {
          p_consent_version: string
          p_email: string
          p_plan_id: string
          p_request_id: string
          p_user_id: string
        }
        Returns: Json
      }
      revise_plan: {
        Args: {
          p_expected_version?: string
          p_payload?: Json
          p_plan_id: string
          p_reopen?: boolean
          p_required_member_ids?: string[]
        }
        Returns: Json
      }
      store_candidate_set: {
        Args: {
          p_input_version: number
          p_plan_id: string
          p_revision: number
          p_set: Json
        }
        Returns: Json
      }
      take_rate_token: {
        Args: {
          p_cost?: number
          p_key_hash: string
          p_limit: number
          p_scope: string
          p_window: string
        }
        Returns: boolean
      }
      verify_email_contact: { Args: { p_token_hash: string }; Returns: Json }
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

