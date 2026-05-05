-- ============================================================
-- AhorraSabor — Migración 002: Monetización + Stats + Seguridad
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- TABLA: financial_ledger
-- Registro inmutable de cada transacción liquidada.
-- Solo el backend (service_role) escribe; el comercio solo lee.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS financial_ledger (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID          NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  merchant_id     UUID          NOT NULL REFERENCES profiles(id),
  total_amount    NUMERIC(10,2) NOT NULL CHECK (total_amount > 0),
  platform_fee    NUMERIC(10,2) NOT NULL CHECK (platform_fee >= 0),
  platform_fee_rate NUMERIC(5,4) NOT NULL DEFAULT 0.15,
  merchant_net    NUMERIC(10,2) NOT NULL CHECK (merchant_net >= 0),
  status          TEXT          NOT NULL DEFAULT 'pending_settlement'
                    CHECK (status IN ('pending_settlement', 'paid_to_merchant')),
  paid_at         TIMESTAMPTZ,
  mp_payment_id   TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_ledger_amounts CHECK (
    ABS((total_amount - platform_fee - merchant_net)) < 0.01
  )
);

CREATE INDEX IF NOT EXISTS idx_ledger_merchant ON financial_ledger(merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_ledger_status   ON financial_ledger(status) WHERE status = 'pending_settlement';

-- ─────────────────────────────────────────────────────────────
-- TABLA: merchant_stats
-- Vista agregada mantenida por trigger. Nunca se escribe a mano.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS merchant_stats (
  merchant_id       UUID          PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  total_revenue     NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_orders      INTEGER       NOT NULL DEFAULT 0,
  total_packs_saved INTEGER       NOT NULL DEFAULT 0,
  total_saved_kg    NUMERIC(10,2) NOT NULL DEFAULT 0,  -- estimado: 0.5 kg por pack
  customer_rating   NUMERIC(3,2)  NOT NULL DEFAULT 0 CHECK (customer_rating BETWEEN 0 AND 5),
  rating_count      INTEGER       NOT NULL DEFAULT 0,
  pending_payout    NUMERIC(10,2) NOT NULL DEFAULT 0,  -- acumulado sin liquidar
  last_payout_at    TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- TABLA: payout_requests
-- Solicitudes de retiro de fondos del comercio.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payout_requests (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID        NOT NULL REFERENCES profiles(id),
  amount      NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  status      TEXT        NOT NULL DEFAULT 'requested'
                CHECK (status IN ('requested', 'processing', 'paid', 'rejected')),
  notes       TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payout_merchant ON payout_requests(merchant_id, status);

-- ─────────────────────────────────────────────────────────────
-- TABLA: order_ratings
-- Ratings por orden entregada.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_ratings (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID        NOT NULL UNIQUE REFERENCES orders(id),
  merchant_id UUID        NOT NULL REFERENCES profiles(id),
  user_id     UUID        NOT NULL REFERENCES profiles(id),
  rating      INTEGER     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- CONSTRAINT DE SEGURIDAD:
-- No se puede marcar 'delivered' si el pago no está aprobado.
-- Usa DO $$ para no fallar si ya existe la constraint.
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_delivery_requires_payment'
      AND table_name = 'orders'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT chk_delivery_requires_payment
      CHECK (
        NOT (status = 'delivered' AND (mp_status IS NULL OR mp_status != 'approved'))
      );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE financial_ledger  ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_stats    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_ratings     ENABLE ROW LEVEL SECURITY;

-- financial_ledger: solo lectura para el comercio dueño
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='financial_ledger' AND policyname='Comercio ve su propio ledger') THEN
    CREATE POLICY "Comercio ve su propio ledger"
      ON financial_ledger FOR SELECT USING (auth.uid() = merchant_id);
  END IF;
  -- Escritura bloqueada para usuarios: solo service_role puede insertar/actualizar
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='financial_ledger' AND policyname='Solo backend escribe ledger') THEN
    CREATE POLICY "Solo backend escribe ledger"
      ON financial_ledger FOR INSERT WITH CHECK (false);
  END IF;
END $$;

-- merchant_stats
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='merchant_stats' AND policyname='Comercio ve sus propias stats') THEN
    CREATE POLICY "Comercio ve sus propias stats"
      ON merchant_stats FOR SELECT USING (auth.uid() = merchant_id);
  END IF;
END $$;

-- payout_requests
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payout_requests' AND policyname='Comercio gestiona sus retiros') THEN
    CREATE POLICY "Comercio gestiona sus retiros"
      ON payout_requests FOR ALL USING (auth.uid() = merchant_id);
  END IF;
END $$;

-- order_ratings
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='order_ratings' AND policyname='Usuario califica sus órdenes') THEN
    CREATE POLICY "Usuario califica sus órdenes"
      ON order_ratings FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='order_ratings' AND policyname='Comercio ve sus ratings') THEN
    CREATE POLICY "Comercio ve sus ratings"
      ON order_ratings FOR SELECT USING (auth.uid() = merchant_id OR auth.uid() = user_id);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- TRIGGER: update_merchant_stats_on_delivery
-- Se dispara cuando una orden pasa a estado 'delivered'.
-- Mantiene merchant_stats sincronizado sin queries adicionales.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_update_merchant_stats_on_delivery()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_net NUMERIC(10,2);
BEGIN
  -- Solo actuar cuando la orden pasa a 'delivered'
  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
    v_net := COALESCE(NEW.net_merchant, 0);

    INSERT INTO merchant_stats (
      merchant_id, total_revenue, total_orders,
      total_packs_saved, total_saved_kg, pending_payout, updated_at
    )
    VALUES (
      NEW.merchant_id, v_net, 1,
      NEW.quantity, NEW.quantity * 0.5, v_net, NOW()
    )
    ON CONFLICT (merchant_id) DO UPDATE SET
      total_revenue     = merchant_stats.total_revenue + v_net,
      total_orders      = merchant_stats.total_orders + 1,
      total_packs_saved = merchant_stats.total_packs_saved + NEW.quantity,
      total_saved_kg    = merchant_stats.total_saved_kg + (NEW.quantity * 0.5),
      pending_payout    = merchant_stats.pending_payout + v_net,
      updated_at        = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_merchant_stats_on_delivery ON orders;
CREATE TRIGGER trg_merchant_stats_on_delivery
  AFTER UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION fn_update_merchant_stats_on_delivery();

-- ─────────────────────────────────────────────────────────────
-- TRIGGER: update_rating_avg
-- Recalcula el rating promedio del comercio al insertar un rating.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_update_merchant_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO merchant_stats (merchant_id, customer_rating, rating_count, updated_at)
  VALUES (NEW.merchant_id, NEW.rating, 1, NOW())
  ON CONFLICT (merchant_id) DO UPDATE SET
    customer_rating = (
      (merchant_stats.customer_rating * merchant_stats.rating_count + NEW.rating)
      / (merchant_stats.rating_count + 1)
    ),
    rating_count = merchant_stats.rating_count + 1,
    updated_at   = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_merchant_rating ON order_ratings;
CREATE TRIGGER trg_merchant_rating
  AFTER INSERT ON order_ratings
  FOR EACH ROW EXECUTE FUNCTION fn_update_merchant_rating();

-- ─────────────────────────────────────────────────────────────
-- TRIGGER: reset_pending_payout_on_payout
-- Cuando se paga al comercio, resetea pending_payout.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_reset_payout_on_paid()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'paid' AND OLD.status != 'paid' THEN
    UPDATE merchant_stats
    SET pending_payout  = GREATEST(pending_payout - NEW.amount, 0),
        last_payout_at  = NOW(),
        updated_at      = NOW()
    WHERE merchant_id = NEW.merchant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_payout ON payout_requests;
CREATE TRIGGER trg_reset_payout
  AFTER UPDATE OF status ON payout_requests
  FOR EACH ROW EXECUTE FUNCTION fn_reset_payout_on_paid();

-- ─────────────────────────────────────────────────────────────
-- Timestamps automáticos
-- ─────────────────────────────────────────────────────────────
CREATE TRIGGER trg_financial_ledger_updated_at
  BEFORE UPDATE ON financial_ledger
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- Habilitar Realtime
-- ─────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE financial_ledger;
ALTER PUBLICATION supabase_realtime ADD TABLE merchant_stats;
