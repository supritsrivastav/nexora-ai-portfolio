-- Initializes a completely fresh production database with the authoritative
-- public schema baseline. This file contains schema definitions only; it does
-- not copy local records, database-role ownership clauses, grants, or
-- connection-specific settings.
-- Apply only to a fresh database. It already includes users, auth_sessions,
-- and support_tickets ticket ownership; do not apply 001_auth_tables.sql or
-- 002_ticket_ownership.sql afterward.

BEGIN;

CREATE SCHEMA IF NOT EXISTS public;
COMMENT ON SCHEMA public IS 'standard public schema';

CREATE TABLE public.auth_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    revoked_at timestamp with time zone
);

CREATE TABLE public.support_tickets (
    id bigint NOT NULL,
    ticket_number character varying(30) NOT NULL,
    user_id character varying(100) NOT NULL,
    issue text NOT NULL,
    category character varying(50),
    priority character varying(20),
    severity character varying(20),
    summary text,
    status character varying(30) DEFAULT 'Open'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    owner_user_id uuid
);

CREATE SEQUENCE public.support_tickets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.support_tickets_id_seq
    OWNED BY public.support_tickets.id;

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(320) NOT NULL,
    email_normalized character varying(320) NOT NULL,
    password_hash text NOT NULL,
    display_name character varying(120),
    is_active boolean DEFAULT true NOT NULL,
    email_verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.support_tickets
    ALTER COLUMN id SET DEFAULT nextval('public.support_tickets_id_seq'::regclass);

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_ticket_number_key UNIQUE (ticket_number);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_normalized_key UNIQUE (email_normalized);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE INDEX auth_sessions_expires_at_idx
    ON public.auth_sessions USING btree (expires_at);

CREATE INDEX auth_sessions_user_id_idx
    ON public.auth_sessions USING btree (user_id);

CREATE INDEX support_tickets_owner_user_id_idx
    ON public.support_tickets USING btree (owner_user_id);

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_owner_user_id_fkey
    FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

COMMIT;
