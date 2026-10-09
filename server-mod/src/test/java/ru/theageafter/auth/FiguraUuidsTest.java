package ru.theageafter.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import org.junit.jupiter.api.Test;

class FiguraUuidsTest {
    @Test
    void ourAccountsLookLikeOnlinePlayers() {
        // How the server (offline mode) and our account server derive a player's UUID.
        UUID account = UUID.nameUUIDFromBytes("OfflinePlayer:Makarkrut".getBytes(StandardCharsets.UTF_8));
        assertEquals(UUID.fromString("6c4cfc61-34a5-33aa-9944-ae7b57694f6f"), account);
        assertEquals(3, account.version());
        assertEquals(4, FiguraUuids.versionForFigura(account));
    }

    @Test
    void otherVersionsAreLeftAlone() {
        assertEquals(4, FiguraUuids.versionForFigura(UUID.fromString("069a79f4-44e9-4726-a5be-fca90e38aaf5")));
        assertEquals(2, FiguraUuids.versionForFigura(UUID.fromString("00000000-0000-2000-8000-000000000000")));
        assertEquals(0, FiguraUuids.versionForFigura(new UUID(0, 0)));
    }
}
