package ru.theageafter.auth;

import java.io.IOException;
import java.io.Reader;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Properties;

/**
 * Plain-Java part of the mod (no Minecraft classes), so it can be unit-tested.
 *
 * <p>authlib reads both system properties in {@code EnvironmentParser} when
 * {@code YggdrasilAuthenticationService} is created, which happens after mod constructors run.
 * Both must be set, otherwise authlib ignores them.
 */
public final class AuthRedirect {
    public static final String SESSION_HOST_PROPERTY = "minecraft.api.session.host";
    public static final String SERVICES_HOST_PROPERTY = "minecraft.api.services.host";
    public static final String API_ROOT_KEY = "api_root";

    static final String TEMPLATE = """
            # The Age After: проверка игроков через наш сервер аккаунтов вместо Mojang.
            # 1. Уберите # в строке api_root и укажите адрес сервера аккаунтов (PUBLIC_URL бэкенда).
            # 2. В server.properties: online-mode=true и enforce-secure-profile=false.
            # 3. Перезапустите сервер.
            #api_root=https://example.up.railway.app
            """;

    private AuthRedirect() {
    }

    /**
     * Reads {@code api_root} from the config file. If the file does not exist, writes a commented
     * template and returns empty. Throws {@link IllegalArgumentException} if the value is not an
     * http(s) URL.
     */
    public static Optional<String> loadApiRoot(Path configFile) throws IOException {
        if (!Files.exists(configFile)) {
            Files.createDirectories(configFile.toAbsolutePath().getParent());
            Files.writeString(configFile, TEMPLATE, StandardCharsets.UTF_8);
            return Optional.empty();
        }
        Properties props = new Properties();
        try (Reader reader = Files.newBufferedReader(configFile, StandardCharsets.UTF_8)) {
            props.load(reader);
        }
        String raw = props.getProperty(API_ROOT_KEY, "").trim();
        if (raw.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(normalizeApiRoot(raw));
    }

    /** {@code https://host/path/} → {@code https://host/path}; rejects anything but http(s) URLs. */
    public static String normalizeApiRoot(String raw) {
        String value = raw.trim();
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        URI uri;
        try {
            uri = new URI(value);
        } catch (URISyntaxException e) {
            throw new IllegalArgumentException("api_root is not a URL: " + raw, e);
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !scheme.equals("http") || uri.getHost() == null) {
            throw new IllegalArgumentException("api_root must start with https:// but is: " + raw);
        }
        if (uri.getQuery() != null || uri.getFragment() != null) {
            throw new IllegalArgumentException("api_root must not contain ? or #: " + raw);
        }
        return value;
    }

    public static String sessionHost(String apiRoot) {
        return apiRoot + "/sessionserver";
    }

    public static String servicesHost(String apiRoot) {
        return apiRoot + "/minecraftservices";
    }

    public static void apply(String apiRoot) {
        System.setProperty(SESSION_HOST_PROPERTY, sessionHost(apiRoot));
        System.setProperty(SERVICES_HOST_PROPERTY, servicesHost(apiRoot));
    }

    /**
     * Problems in server.properties that make the redirect useless; empty if all is fine or the file is missing.
     * Log messages are ASCII on purpose: hosting consoles often lack UTF-8.
     */
    public static List<String> checkServerProperties(Path serverProperties) throws IOException {
        List<String> problems = new ArrayList<>();
        if (!Files.exists(serverProperties)) {
            return problems;
        }
        Properties props = new Properties();
        try (Reader reader = Files.newBufferedReader(serverProperties, StandardCharsets.ISO_8859_1)) {
            props.load(reader);
        }
        if (!"true".equalsIgnoreCase(props.getProperty("online-mode", "true").trim())) {
            problems.add("server.properties has online-mode=false: players are not verified at all, anyone can join with any name. Set online-mode=true.");
        }
        if ("true".equalsIgnoreCase(props.getProperty("enforce-secure-profile", "true").trim())) {
            problems.add("server.properties has enforce-secure-profile=true: players will be kicked for missing chat signatures. Set enforce-secure-profile=false.");
        }
        return problems;
    }
}
