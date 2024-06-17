import fs from "fs-extra";
import * as cohost from "cohost-api";
import util from "node:util";

import bot from "../bot.js";

const name = "Cohost";
const globalTags = [ "automated post", "bot", "ca-dmv-bot", "The Cohost Bot Feed" ];

let user;
let handle;
let project;

async function authenticate(credentials) {
    const client = new cohost.Client();
    
    return new Promise(async (resolve) => {
        user = await client.login(credentials.email, credentials.password);
        
        project = user?.projects[0];
        handle = project?.handle;
        if (!project) {
            console.log("Couldn't log in.");
            resolve();
        }
        
        user?.switchProject(project);
        
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
        const post = new cohost.PostBuilder()
            .addMarkdownBlock(text);
        const tags = [...globalTags, `VERDICT: ${verdict}`, plate.text];
        for (const tag of tags)
            post.addTag(tag);
        post.build();
        project.createDraft(post);
        project.addAttachment(post, fs.readFileSync(plate.fileName, { encoding: "base64" }));
        cohost.publishDraft(post);
        resolve(`https://cohost.org/${handle}/post/${post.id}-x`);
    });
}

async function updateBio() {
  //no way to do this in cohost.js yet :(
}

export default { name, authenticate, post, updateBio };