BEGIN;

ALTER TABLE support_tickets
    ADD COLUMN owner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX support_tickets_owner_user_id_idx
    ON support_tickets (owner_user_id);

COMMIT;
