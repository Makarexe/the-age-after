package ru.theageafter.auth.mixin;

import java.util.UUID;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;
import ru.theageafter.auth.FiguraUuids;

/** NetworkStuff.checkUUID: guards fetching a player's profile and avatar and the event subscriptions. */
@Pseudo
@Mixin(targets = "org.figuramc.figura.backend2.NetworkStuff", remap = false)
public abstract class FiguraNetworkStuffMixin {
    @Redirect(
            method = "checkUUID",
            at = @At(value = "INVOKE", target = "Ljava/util/UUID;version()I"),
            require = 0,
            remap = false)
    private static int ageafterauth$uuidVersion(UUID id) {
        return FiguraUuids.versionForFigura(id);
    }
}
