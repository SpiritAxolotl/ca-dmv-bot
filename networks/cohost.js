import fs from "fs-extra";
import cohost from "cohost";
import util from "node:util";

import bot from "../bot.js";

const name = "Cohost";
const globalTags = [ "automated post", "bot", "ca-dmv-bot", "The Cohost Bot Feed" ];

let client;
let handle;
let project;

async function authenticate(credentials) {
    client = new cohost.User();
    
    return new Promise(async (resolve) => {
        await client.login(credentials.email, credentials.password);
        
        project = client.getProjects()[0];
        handle = credentials.handle;
        
        console.log(`Logged into Cohost as "${handle}"`);
        resolve();
    });
}

async function post(plate) {
    const verdict = plate.verdict === true ? "ACCEPTED" : plate.verdict === false ? "DENIED" : "(NOT ON RECORD)";
    const text = util.format(bot.formats.post,
        plate.customerComment.replaceAll("\n", "\n&nbsp;&nbsp;&nbsp;&nbsp;"),
        plate.dmvComment.replaceAll("\n", "\n&nbsp;&nbsp;&nbsp;&nbsp;"),
        plate.approver.tag.replaceAll("-->", ""),
        plate.approver.id,
        verdict
    );
    //const altText = bot.formatAltText(plate.text).replaceAll(`"`, "").replaceAll(".", "");
    
    return new Promise(async (resolve) => {
        const id = await cohost.Post.create(project, {
            postState: 0, //draft
            headline: "test",
            adultContent: false,
            blocks: [{
                type: "markdown",
                content: text
            }],
            tags: [...globalTags, `VERDICT: ${verdict}`, plate.text]
        });
        const attachmentData = await project.uploadAttachment(
            id,
            fs.readFileSync(plate.fileName, { encoding: "base64" })
        );
        /*let basePost = "???";
        await cohost.Post.update(project, id, {
            ...basePost,
            postState: 1,
            blocks: [
                ...basePost.blocks,
                { type: "attachment", attachment: { ...attachmentData } }
            ],
            tags: [...basePost.tags]
        });*/
        resolve(`https://cohost.org/${handle}/post/${id}-x`);
    });
}

async function updateBio() {
  //no way to do this in cohost.js yet :(
}

export default { name, authenticate, post, updateBio };