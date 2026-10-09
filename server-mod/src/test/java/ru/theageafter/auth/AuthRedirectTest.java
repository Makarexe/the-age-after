package ru.theageafter.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class AuthRedirectTest {
    @TempDir
    Path dir;

    @Test
    void missingFileCreatesCommentedTemplate() throws Exception {
        Path file = dir.resolve("config/ageafterauth.properties");
        assertEquals(Optional.empty(), AuthRedirect.loadApiRoot(file));
        assertTrue(Files.readString(file, StandardCharsets.UTF_8).contains("#api_root="));
        // The template itself still means "not configured".
        assertEquals(Optional.empty(), AuthRedirect.loadApiRoot(file));
    }

    @Test
    void readsAndNormalizesApiRoot() throws Exception {
        Path file = dir.resolve("ageafterauth.properties");
        Files.writeString(file, "# комментарий\napi_root = https://auth.example.com/ \n", StandardCharsets.UTF_8);
        assertEquals(Optional.of("https://auth.example.com"), AuthRedirect.loadApiRoot(file));
    }

    @Test
    void rejectsNonHttpValues() {
        assertThrows(IllegalArgumentException.class, () -> AuthRedirect.normalizeApiRoot("auth.example.com"));
        assertThrows(IllegalArgumentException.class, () -> AuthRedirect.normalizeApiRoot("ftp://auth.example.com"));
        assertThrows(IllegalArgumentException.class, () -> AuthRedirect.normalizeApiRoot("https://auth.example.com/?x=1"));
        assertEquals("https://auth.example.com/api", AuthRedirect.normalizeApiRoot("https://auth.example.com/api//"));
    }

    @Test
    void setsBothAuthlibProperties() {
        AuthRedirect.apply("https://auth.example.com");
        assertEquals("https://auth.example.com/sessionserver", System.getProperty(AuthRedirect.SESSION_HOST_PROPERTY));
        assertEquals("https://auth.example.com/minecraftservices", System.getProperty(AuthRedirect.SERVICES_HOST_PROPERTY));
    }

    @Test
    void warnsAboutServerProperties() throws Exception {
        Path props = dir.resolve("server.properties");
        Files.writeString(props, "online-mode=false\nenforce-secure-profile=true\n");
        List<String> problems = AuthRedirect.checkServerProperties(props);
        assertEquals(2, problems.size());

        Files.writeString(props, "online-mode=true\nenforce-secure-profile=false\n");
        assertTrue(AuthRedirect.checkServerProperties(props).isEmpty());
        assertTrue(AuthRedirect.checkServerProperties(dir.resolve("missing.properties")).isEmpty());
    }
}
