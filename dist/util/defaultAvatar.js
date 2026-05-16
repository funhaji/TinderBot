import { InputFile } from "grammy";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_AVATAR_PATH = path.resolve(__dirname, "../../assets/default-profile.png");
export function defaultAvatarFile() {
    return new InputFile(DEFAULT_AVATAR_PATH);
}
