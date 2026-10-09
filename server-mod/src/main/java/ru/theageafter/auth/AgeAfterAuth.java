package ru.theageafter.auth;

import java.nio.file.Path;
import java.util.Optional;

import net.neoforged.fml.common.Mod;
import net.neoforged.fml.loading.FMLEnvironment;
import net.neoforged.fml.loading.FMLPaths;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Points the dedicated server's authlib at The Age After account server, so {@code online-mode=true}
 * checks players against our accounts instead of Mojang. Does nothing on the client.
 */
@Mod(AgeAfterAuth.MOD_ID)
public final class AgeAfterAuth {
    public static final String MOD_ID = "ageafterauth";
    public static final String CONFIG_FILE = MOD_ID + ".properties";

    private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    public AgeAfterAuth() {
        if (!FMLEnvironment.dist.isDedicatedServer()) {
            LOGGER.info("{} is server-only, doing nothing on the client.", MOD_ID);
            return;
        }

        Path configFile = FMLPaths.CONFIGDIR.get().resolve(CONFIG_FILE);
        Optional<String> apiRoot;
        try {
            apiRoot = AuthRedirect.loadApiRoot(configFile);
        } catch (Exception e) {
            LOGGER.error("Could not read {}: players are still verified by Mojang.", configFile, e);
            return;
        }
        if (apiRoot.isEmpty()) {
            LOGGER.warn("api_root is not set in {}: players are still verified by Mojang. Edit that file and restart.",
                    configFile);
            return;
        }

        String root = apiRoot.get();
        AuthRedirect.apply(root);
        LOGGER.info("Player verification redirected to {} (session: {}, services: {})",
                root, AuthRedirect.sessionHost(root), AuthRedirect.servicesHost(root));

        try {
            for (String problem : AuthRedirect.checkServerProperties(FMLPaths.GAMEDIR.get().resolve("server.properties"))) {
                LOGGER.warn(problem);
            }
        } catch (Exception e) {
            LOGGER.debug("Could not check server.properties", e);
        }
    }
}
