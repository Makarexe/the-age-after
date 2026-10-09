package ru.theageafter.auth;

import java.util.UUID;

/**
 * Figura only talks to its cloud about players whose UUID is version 4 (random, as Mojang's are)
 * and treats everyone else as an offline player without an avatar. Our accounts have name-based
 * (version 3) UUIDs, the ones the server uses in offline mode, so that switching online-mode keeps
 * player data. The mixins make Figura see them as version 4; nothing else changes.
 */
public final class FiguraUuids {
    private FiguraUuids() {}

    /** The UUID version Figura gets to see. */
    public static int versionForFigura(UUID id) {
        int version = id.version();
        return version == 3 ? 4 : version;
    }
}
