-- ============================================================
-- AhorraSabor — Migración inicial
-- Ejecutar en: Supabase → SQL Editor
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLAS
-- ============================================================

CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'merchant')),
  name        TEXT        NOT NULL,
  geo_lat     FLOAT8,
  geo_lng     FLOAT8,
  fcm_token   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE packs (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  description     TEXT,
  price_reg       NUMERIC(10,2) NOT NULL CHECK (price_reg > 0),
  price_offer     NUMERIC(10,2) NOT NULL CHECK (price_offer > 0),
  stock           INTEGER     NOT NULL DEFAULT 0 CHECK (stock >= 0),
  reserved_stock  INTEGER     NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0),
  end_time        TIMESTAMPTZ NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'expired', 'donated')),
  image_url       TEXT,
  category        TEXT        NOT NULL DEFAULT 'Panadería',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraint de negocio: precio de oferta máximo 70% del regular (≥ 30% descuento)
  CONSTRAINT chk_price_offer_discount
    CHECK (price_offer <= price_reg * 0.70),

  -- No puede reservarse más de lo que hay en stock
  CONSTRAINT chk_reserved_lte_stock
    CHECK (reserved_stock <= stock)
);

CREATE TABLE orders (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES profiles(id),
  pack_id         UUID        NOT NULL REFERENCES packs(id),
  merchant_id     UUID        NOT NULL REFERENCES profiles(id),
  status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'paid', 'delivered', 'cancelled')),
  quantity        INTEGER     NOT NULL DEFAULT 1 CHECK (quantity > 0),
  total           NUMERIC(10,2) NOT NULL CHECK (total > 0),
  platform_fee    NUMERIC(10,2),      -- 15 % de total
  net_merchant    NUMERIC(10,2),      -- 85 % de total
  mp_preference_id TEXT,
  mp_payment_id   TEXT,
  mp_status       TEXT,
  qr_token        TEXT        UNIQUE,      -- valor completo: AS:{id}:{nonce}:{sig}
  qr_token_hash   TEXT        UNIQUE,      -- SHA-256 del qr_token, para lookup rápido
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ÍNDICES
-- ============================================================

CREATE INDEX idx_packs_merchant      ON packs(merchant_id);
CREATE INDEX idx_packs_active        ON packs(status, end_time) WHERE status = 'active';
CREATE INDEX idx_packs_category      ON packs(category, status);
CREATE INDEX idx_orders_user         ON orders(user_id, created_at DESC);
CREATE INDEX idx_orders_merchant     ON orders(merchant_id, status);
CREATE INDEX idx_orders_qr_hash      ON orders(qr_token_hash) WHERE qr_token_hash IS NOT NULL;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE packs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders   ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "Lectura pública de perfiles"
  ON profiles FOR SELECT USING (true);

CREATE POLICY "Usuario actualiza su propio perfil"
  ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Usuario inserta su perfil en registro"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Packs
CREATE POLICY "Packs públicamente visibles"
  ON packs FOR SELECT USING (true);

CREATE POLICY "Comercio gestiona sus propios packs"
  ON packs FOR ALL USING (auth.uid() = merchant_id);

-- Orders
CREATE POLICY "Usuario ve sus propias órdenes"
  ON orders FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = merchant_id);

CREATE POLICY "Usuario autenticado crea órdenes"
  ON orders FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Las actualizaciones de orders SOLO las hace el backend vía service_role key.
-- El cliente (anon/authenticated) no puede mutar estado de órdenes.
CREATE POLICY "Solo service_role actualiza órdenes"
  ON orders FOR UPDATE USING (false);

CREATE POLICY "Solo service_role elimina órdenes"
  ON orders FOR DELETE USING (false);

-- ============================================================
-- FUNCIÓN: Auto-expirar packs (invocar con pg_cron cada hora)
-- ============================================================

CREATE OR REPLACE FUNCTION expire_stale_packs()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE packs
  SET status     = 'expired',
      updated_at = NOW()
  WHERE status   = 'active'
    AND end_time  < NOW();
END;
$$;

-- Si habilitaste pg_cron en Supabase:
-- SELECT cron.schedule('expire-packs', '0 * * * *', 'SELECT expire_stale_packs()');

-- ============================================================
-- FUNCIÓN: Trigger updated_at automático
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_packs_updated_at BEFORE UPDATE ON packs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- HABILITAR REALTIME para packs y orders
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE packs;
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
