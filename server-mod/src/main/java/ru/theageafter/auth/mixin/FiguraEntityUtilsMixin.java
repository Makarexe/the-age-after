package ru.theageafter.auth.mixin;

import java.util.UUID;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;
import ru.theageafter.auth.FiguraUuids;

/** EntityUtils.checkInvalidPlayer: decides whether a player's avatar is requested at all. */
@Pseudo
@Mixin(targets = "org.figuramc.figura.utils.EntityUtils", remap = false)
public abstract class FiguraEntityUtilsMixin {
    @Redirect(
            method = "checkInvalidPlayer",
            at = @At(value = "INVOKE", target = "Ljava/util/UUID;version()I"),
            require = 0,
            remap = false)
    private static int ageafterauth$uuidVersion(UUID id) {
        return FiguraUuids.versionForFigura(id);
    }
}
