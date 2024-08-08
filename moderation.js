import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    Events,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder
} from "discord.js";

import fs from "fs-extra";
import util from "node:util";

import app from "./app.js";
import bot from "./bot.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages] });
let channel;
let moderatorRoleId;
let trustedOptInRoleId;
let ownerUserId;

function initialize(credentials) {
    moderatorRoleId = credentials.moderatorRoleId;
    ownerUserId = credentials.ownerUserId;
    trustedOptInRoleId = credentials.trustedOptInRoleId;
    
    return new Promise((resolve) => {
        client.login(credentials.token);
        
        client.once(Events.ClientReady, async () => {
            await deployCommands(credentials.token);
            
            app.log(`Logged into Discord as "${client.user.tag}" (${client.user.id})`);
            channel = client.channels.cache.find(channel => channel.id === credentials.channelId);
            
            resolve();
        })
        
        client.on(Events.InteractionCreate, async (interaction) => {
            let ephemeral = interaction.options?.getBoolean("ephemeral") ?? interaction.commandName !== "review";
            if (!interaction.isChatInputCommand() ||
                !interactionFilter(interaction)
            )
                return;
            
            //if (![].includes(interaction.commandName))
            await interaction.deferReply({ ephemeral: ephemeral });
            
            await interaction.guild.roles.fetch();
            
            await handleCommands(interaction);
        });
    });
}

async function handleCommands(interaction) {
    switch (interaction.commandName) {
        case "ping":
            await interaction.editReply("Pong!"); //should return ms
            break;
        case "bio":
            if (!isOwner(interaction)) {
                await interaction.editReply("You are not authorized to use this command.");
                return;
            }
            
            await bot.updateBio();
            await interaction.editReply("Refreshed bio!");
            
            break;
        case "post":
            await post(interaction);
            break;
        case "post_custom":
            const plate = await bot.getPlate({
                "text": interaction.options.getString("plate", true),
                "customerComment": interaction.options.getString("customerComment", true),
                "dmvComment": interaction.options.getString("dmvComment", true),
                "verdict": interaction.options.getString("verdict", true),
                "submitter": interaction.options.getString("submitter", true),
                "draft": interaction.options.getBoolean("draft", false) ?? true
            });
            await post(interaction, plate);
            break;
        case "review":
            await startReviewProcessForUser(interaction);
            break;
        case "queue":
            const queue = app.getQueue().map(plate => `\`${plate.text}\``);
            const one = queue.length===1?"s":"";
            
            if (queue.length === 0)
                await interaction.editReply("There are no plates in the queue.");
            else
                await interaction.editReply(`There ${one?"is":"are"} **${queue.length}** plate${one?"":"s"} left to be posted, and they are (from first to last): ${queue.reverse().join(", ")}.`);
            break;
        case "optin":
            await optInForUser(interaction);
            break;
        case "optout":
            if (!interaction.member.roles.cache.find(role => role.id === moderatorRoleId)) {
                app.log(`"${interaction.user.tag}" (${interaction.user.id}) tried to opt out without the moderator role!`);
                await interaction.editReply({
                    content: `You didn't have the <@&${moderatorRoleId}> role!`,
                    ephemeral: true
                });
                return;
            }
            app.log(`"${interaction.user.tag}" (${interaction.user.id}) opted out`);
            interaction.member.roles.remove(moderatorRoleId);
            await interaction.editReply({
                content: `You've successfully opted out of the <@&${moderatorRoleId}> role.`,
                ephemeral: true
            });
            break;
        case "run":
            await app.run();
            await interaction.editReply({
                content: `Run!`,
                ephemeral: true
            });
            break;
        case "plate":
            const text = interaction.options.getString("text", true).toUpperCase().trim();
            await bot.drawPlateImage(text, `./data/tmp/${text}.png`);
            await interaction.editReply({
                content: `Here's your custom plate:`,
                files: [ new AttachmentBuilder(`./data/tmp/${text}.png`) ],
                ephemeral: false
            });
            break;
        //case "post_custom":
            //bot
    }
}

async function deployCommands(token) {
    const rest = new REST({ version: "10" }).setToken(token);
    const commands = [
        new SlashCommandBuilder().setName("ping").setDescription("Replies with pong!").toJSON(),
        new SlashCommandBuilder().setName("plate").setDescription("Create a plate with custom text").addStringOption(option=>option
            .setName("text")
            .setDescription("What text to put on the license plate. Must be 9 characters or less.")
            .setRequired(true)
        ).toJSON(),
        new SlashCommandBuilder().setName("post").setDescription("Manually posts the next plate in queue").toJSON(),
        new SlashCommandBuilder().setName("post_custom").setDescription("Make a custom post (will be tagged as community submission)")
        .addStringOption(option=>option
            .setName("plate")
            .setDescription("What text to put on the license plate. Must be 9 characters or less.")
            .setRequired(true)
        ).addStringOption(option=>option
            .setName("customerComment")
            .setDescription("What the customer's spiel is. Max 190 characters.")
            .setRequired(true)
        ).addStringOption(option=>option
            .setName("dmvComment")
            .setDescription("What the DMV's response is. Max 190 characters.")
            .setRequired(true)
        ).addBooleanOption(option=>option
            .setName("verdict")
            .setDescription("What the final verdict is. True = APPROVED, False = DENIED")
            .setRequired(true)
        ).addStringOption(option=>option
            .setName("submitter")
            .setDescription("The handle of the cohost project that submitted this. Omit for \"Anonymous User\".")
            .setRequired(false)
        ).addBooleanOption(option=>option
            .setName("draft")
            .setDescription("Whether this should be published as a draft or not. Default: True")
            .setRequired(false)
        ).toJSON(),
        new SlashCommandBuilder().setName("run").setDescription("Manually run the bot!").toJSON(),
        new SlashCommandBuilder().setName("bio").setDescription("Updates the bot's bio").toJSON(),
        new SlashCommandBuilder().setName("review").setDescription("Review some plates").addBooleanOption(option=>option
            .setName("ephemeral")
            .setDescription("Whether or not the reply message should only be visible to you. Default: False")
            .setRequired(false)
        ).toJSON(),
        new SlashCommandBuilder().setName("queue").setDescription("Returns the plates in the queue").toJSON(),
        new SlashCommandBuilder().setName("shuffle").setDescription("Shuffles the queue").toJSON(),
        new SlashCommandBuilder().setName("optin").setDescription("Opt-in to the moderator role").toJSON(),
        new SlashCommandBuilder().setName("optout").setDescription("Opt-out of the moderator role").toJSON(),
    ];
    
    await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
    );
}

async function interactionFilter(interaction) {
    const member = channel.guild.members.cache.get(interaction.user.id);
    const sameChannel = interaction.channelId === channel.id;
    const testing = process.env.TESTING;
    const owner = isOwner(interaction);
    if (owner) return true;
    if (!sameChannel) return false;
    if (testing && member.bot && member.roles.cache.has(moderatorRoleId)) return true;
    if (!member.bot && member.roles.cache.has(moderatorRoleId)) return true;
    return false;
}

function isOwner(interaction) {
    //app.log(`${interaction.user.id} (${typeof interaction.user.id})\n${ownerUserId} (${typeof ownerUserId})`);
    return ownerUserId.includes(interaction.user.id);
}

function _process() {
    return new Promise(async (resolve) => {
        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel("Let me review some plates")
                    .setStyle(ButtonStyle.Primary)
                    .setCustomId("review")
                    .setDisabled(false)
            );
        const escape = process.env.TESTING ? "\\" : "";
        const message = await channel.send({
            components: [ buttons ],
            content: `${escape}<@&${moderatorRoleId}${escape}> The queue is empty and new plates need to be reviewed! </review:1251277993691709474>`
        });
        
        let opportunist = null;
        const collector = message.createMessageComponentCollector({ interactionFilter, time: 60 * 60 * 24 * 1000 });
        collector.on("collect", async (interaction) => {
            if (opportunist !== null)
                return;
            
            await interaction.deferReply({ ephemeral: false });
            
            opportunist = channel.guild.members.cache.get(interaction.user.id);
            await message.edit({
                components: [],
                content: `~~${message.content}~~ <@${opportunist.id}> took the opportunity.`
            });
            
            const plates = await startReviewProcessForUser(interaction);
            resolve(plates);
        });
    });
}

async function post(interaction, custom) {
    if (!isOwner(interaction)) {
        await interaction.editReply("You are not authorized to use this command.");
        return;
    }
    
    await interaction.editReply("Posting plate...");
    
    if (!custom) {
        const queue = app.getQueue();
        if (queue.length === 0) {
            await interaction.editReply("There is no plate to post - please review some plates first.");
            return;
        }
    }
    
    if (custom)
        await bot.post(custom);
    else {
        await bot.post(queue.pop());
        fs.writeFileSync("./data/queue.json", JSON.stringify(queue));
    }
    
    updateStatus();
    await notifyQueueAmount();
    
    await interaction.editReply("Posted plate!");
}

async function optInForUser(interaction) {
    const tag = interaction.user.tag;
    const userid = interaction.user.id;
    
    app.log(`"${tag}" (${userid}) ran the opt-in command!`);
    
    await new Promise(async (resolve) => {
        if (interaction.member.roles.cache.find(role => role.id === moderatorRoleId)) {
            await interaction.editReply(`You already opted-in and have the <@&${moderatorRoleId}> role!`);
            return;
        } else if (trustedOptInRoleId && !interaction.member.roles.cache.find(role => role.id === trustedOptInRoleId)) {
            await interaction.editReply(`You aren't eligible to opt-in. DM <@${ownerUserId}> to request the role (with reason as to why you want it).`);
            return;
        }
        
        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel("I agree")
                    .setStyle(ButtonStyle.Primary)
                    .setCustomId("agree")
                    .setDisabled(false)
            )
            .addComponents(
                new ButtonBuilder()
                    .setLabel("Nevermind...")
                    .setStyle(ButtonStyle.Secondary)
                    .setCustomId("nevermind")
                    .setDisabled(false)
            );
        const message = await interaction.editReply({
            components: [ buttons ],
            content: `By obtaining this role, you agree to follow the guidelines (pinned in the dedicated channel) regarding which license plates are appropriate to post.\n\n(This message will time out in one minute)`,
            ephemeral: true
        });
        
        const filter = async (response) => {
            const validIds = ["agree", "nevermind"];
            return response.user.tag === tag && validIds.includes(response.customId);
        };
        
        const collector = message.createMessageComponentCollector({ filter, time: 60 * 1000 });
        collector.on("collect", async (response) => {
            switch (response.customId) {
                case "agree":
                    app.log(`"${tag}" (${userid}) opted in!`);
                    interaction.member.roles.add(moderatorRoleId);
                    await interaction.editReply({
                        content: `Thank you for agreeing to participate! You now have the <@&${moderatorRoleId}> role, and have access to the ${channel} channel.`,
                        components: [],
                        ephemeral: true
                    });
                    break;
                case "nevermind":
                    app.log(`"${tag}" (${userid}) had second thoughts about opting in.`);
                    await interaction.editReply({
                        content: `Ok. Run the command again if you change your mind!`,
                        components: [],
                        ephemeral: true
                    });
                    break;
            }
            
            response.deferUpdate({ ephemeral: true });
            collector.stop();
            resolve();
        });
        
        collector.on("end", async (collected) => {
            if (!collected.size) {
                await interaction.editReply({
                    content: `Command timed out.`,
                    components: [],
                    ephemeral: true
                });
                
                collector.stop();
                resolve();
            }
        });
    });
}

async function startReviewProcessForUser(interaction) {
    let approvedPlates = [];
    let isReviewing = true;
    const tag = interaction.user.tag;
    const userid = interaction.user.id;
    
    app.log(`"${tag}" (${userid}) started reviewing plates.`);
    
    while (isReviewing) {
        await new Promise(async (resolve) => {
            let plate = await bot.getPlate();
            bot.removePlateFromRecords(plate);
            
            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel("Approve")
                        .setStyle(ButtonStyle.Primary)
                        .setCustomId("approve")
                        .setDisabled(false)
                )
                .addComponents(
                    new ButtonBuilder()
                        .setLabel("Disapprove")
                        .setStyle(ButtonStyle.Danger)
                        .setCustomId("disapprove")
                        .setDisabled(false)
                )
                .addComponents(
                    new ButtonBuilder()
                        .setLabel("I'm finished reviewing plates")
                        .setStyle(ButtonStyle.Secondary)
                        .setCustomId("finished")
                        .setDisabled(/*approvedPlates.length === 0*/ false)
                );
            
            const examplePostText = util.format(bot.formats.previewpost,
                plate.customerComment,
                plate.dmvComment,
                plate.verdict === true ? "ACCEPTED" :  plate.verdict === false ? "DENIED" : "(NOT ON RECORD)"
            );
            
            const message = await interaction.editReply({
                files: [ new AttachmentBuilder(plate.fileName) ],
                components: [ buttons ],
                content: `Click the appropriate button to approve or disapprove this plate (\`${plate.text}\`). Please refer to the pins for moderation guidelines. This message will time out in **5 minutes**.\n\`\`\`${examplePostText}\`\`\``,
                ephemeral: true
            });
            
            const filter = async (response) => {
                const validIds = ["approve", "disapprove", "finished"];
                return response.user.tag === tag && validIds.includes(response.customId);
            };
            
            const collector = message.createMessageComponentCollector({ filter, time: 60 * 5 * 1000 });
            
            collector.on("collect", async (response) => {
                await interaction.editReply({
                    "components": [],
                    "files": [],
                });
                let text = "";
                
                switch (response.customId) {
                    case "approve":
                        app.log(`"${tag}" (${userid}) approved plate \`${plate.text}\`.`);
                        plate.approval.user = interaction.user;
                        plate.approval.time = (new Date()).toISOString();
                        app.addPlatesToQueue([plate]);
                        approvedPlates.push(plate);
                        updateStatus();
                        text = `**Approved \`${plate.text}\`.** Fetching next plate...`;
                        break;
                    case "disapprove":
                        app.log(`"${tag}" (${userid}) disapproved plate \`${plate.text}\`.`);
                        bot.removePlate(plate);
                        text = `**Disapproved \`${plate.text}\`.** Fetching next plate...`;
                        break;
                    case "finished":
                        app.log(`"${tag}" (${userid}) stopped reviewing plates.`);
                        isReviewing = false;
                        text = `Stopped reviewing plates. You approved **${approvedPlates.length} plate${approvedPlates.length!==1?"s":""}.** You may always enter the command </review:1251277993691709474> to restart the review process and </queue:1251277993691709475> to see all plates in queue to be posted.`;
                        break;
                }
                await interaction.editReply({
                    "components": [],
                    "files": [],
                    "content": text
                });
                
                response.deferUpdate({ ephemeral: true });
                collector.stop();
                resolve();
            });
            
            collector.on("end", async (collected) => {
                if (!collected.size) {
                    await interaction.editReply({
                        components: [],
                        files: [],
                        content: `Stopped reviewing plates (timed out). You approved **${approvedPlates.length} plate${approvedPlates.length!==1?"s":""}.** You may always enter the command </review:1251277993691709474> to restart the review process.`
                    });
                    
                    isReviewing = false;
                    
                    collector.stop();
                    resolve();
                }
            });
        });
    }
    
    return approvedPlates;
}

async function notify(plate) {
    return await channel.send(`Posting plate \`${plate.text}\`...`);
}

async function updateNotification(notification, plate, urls, finished) {
    let body = `Posting plate \`${plate.text}\`...${finished ? " finished!" : ""}\n`;
    
    for (const [service, url] of Object.entries(urls))
        body += `**${service}:** <${url}>\n`;
    
    await notification.edit(body);
}

async function notifyQueueAmount() {
    const queue = app.getQueue();
    const one = queue.length===1?"s":"";
    await channel.send(`There ${one?"is":"are"} **${queue.length}** plate${one?"":"s"} left in the queue.`);
    
    if (queue.length === 0)
        await _process();
}

function updateStatus() {
    const queue = app.getQueue();
    client.user.setPresence({ activities: [{ name: `${queue.length} plate${queue.length!==1?"s":""} left to be posted` }] });
}

export default {
    initialize,
    _process,
    notify,
    updateNotification,
    notifyQueueAmount,
    updateStatus,
    client
};