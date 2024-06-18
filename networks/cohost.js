import cohost from "cohost";
import app from "./../app.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import util from "node:util";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

import bot from "../bot.js";

const name = "Cohost";
const globalTags = [ "automated post", "bot", "ca-dmv-bot", "The Cohost Bot Feed" ];

let user;
let handle;
let project;

async function authenticate(credentials) {
    user = new cohost.User();
    
    return new Promise(async (resolve) => {
        await user.login(credentials.email, credentials.password);
        
        handle = credentials.handle;
        project = (await user.getProjects()).find((p) => p.handle === handle);
        
        if (!project) {
            console.error(
                new Error(`No cohost projects found for ${handle}`)
            );
            resolve();
            return undefined;
        }
        
        app.log(`Logged into Cohost as "${handle}"`);
        resolve();
    });
}

async function post(plate) {
    const verdict = plate.verdict === true ? "ACCEPTED" : plate.verdict === false ? "DENIED" : "(NOT ON RECORD)";
    const text = util.format(bot.formats.post,
        plate.text,
        plate.customerComment.replaceAll("\n", "\n&nbsp;&nbsp;&nbsp;&nbsp;"),
        plate.dmvComment.replaceAll("\n", "\n&nbsp;&nbsp;&nbsp;&nbsp;"),
        verdict,
        plate.approval.user.tag, //thankfully we don't need to sanitize because discord's new username system can only have characters that match /[a-z0-9_-]/ (we are hoping a bot user doesn't do this)
        plate.approval.user.id,
        plate.approval.time.toISOString()
    );
    const altText = bot.formatAltText(plate.text).replaceAll(`"`, "").replaceAll(".", "");
    
    return new Promise(async (resolve) => {
        const basePost = {
            postState: 0, //draft
            headline: "",
            adultContent: false,
            blocks: [{
                type: "markdown",
                markdown: { content: text }
            }],
            tags: [...globalTags, `VERDICT: ${verdict}`, `license plate "${plate.text}"`],
            cws: []
        };
        const draftId = await cohost.Post.create(project, basePost);
        app.log("uploading attachment...");
        const attachmentData = await project.uploadAttachment(
            draftId,
            path.resolve(__dirname, plate.fileName)
        );
        await cohost.Post.update(project, draftId, {
            ...basePost,
            postState: 1,
            blocks: [
                ...basePost.blocks,
                { type: "attachment", attachment: { ...attachmentData, altText: altText } }
            ],
            tags: [...basePost.tags]
        });
        resolve(`https://cohost.org/${handle}/post/${draftId}-${plate.text.toLowerCase().replaceAll(/[^a-z0-9-]/g, "-")}-plate`);
    });
}

async function updateBio() {
    //no way to do this in cohost.js yet :(
}

export default { name, authenticate, post, updateBio };