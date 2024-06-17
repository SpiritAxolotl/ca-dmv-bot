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
            
            console.log(`Logged into Discord as "${client.user.tag}" (${client.user.id})`);
            channel = client.channels.cache.find(channel => channel.id === credentials.channelId);
            
            resolve();
        })
        
        client.on(Events.InteractionCreate, async (interaction) => {
            if (!interaction.isChatInputCommand() || !interactionFilter(interaction))
                return;
            
            let queue = app.getQueue();
            
            //if (![].includes(interaction.commandName))
            await interaction.deferReply({ ephemeral: true });
            
            await interaction.guild.roles.fetch();
            
            switch (interaction.commandName) {
                case "ping":
                    await interaction.editReply("Pong!"); //should return ms
                    break;
                case "bio":
                    if (interaction.user.id !== ownerUserId) {
                        await interaction.editReply("You are not authorized to use this command.");
                        return;
                    }
                    
                    await bot.updateBio();
                    await interaction.editReply("Refreshed bio!");
                    
                    break;
                case "post":
                    if (interaction.user.id !== ownerUserId) {
                        await interaction.editReply("You are not authorized to use this command.");
                        return;
                    }
                    
                    await interaction.editReply("Posting plate...");
                    
                    if (queue.length === 0) {
                        await interaction.editReply("There is no plate to post - please review some plates first.");
                        return;
                    }
                    
                    await bot.post(queue.pop());
                    fs.writeFileSync("./data/queue.json", JSON.stringify(queue));
                    
                    updateStatus(queue.length);
                    await notifyQueueAmount(queue.length);
                    
                    await interaction.editReply("Posted plate!");
                    break;
                case "review":
                    await startReviewProcessForUser(interaction);
                    break;
                case "queue":
                    queue = queue.map(plate => `\`${plate.text}\``);
                    
                    await interaction.editReply(queue.length === 0 ? "There are no plates in the queue." : `There are **${queue.length}** plate${queue.length!==1?"s":""} left to be posted, and they are (from first to last): ${queue.reverse().join(", ")}.`);
                    break;
                case "optin":
                    await optInForUser(interaction);
                    break;
                case "optout":
                    if (!interaction.member.roles.cache.find(role => role.id === moderatorRoleId)) {
                        console.log(`"${interaction.user.tag}" (${interaction.user.id}) tried to opt out without the moderator role!`);
                        await interaction.editReply({
                            content: `You didn't have the <@&${moderatorRoleId}> role!`,
                            ephemeral: true
                        });
                        return;
                    }
                    console.log(`"${interaction.user.tag}" (${interaction.user.id}) opted out`);
                    interaction.member.roles.remove(moderatorRoleId);
                    await interaction.editReply({
                        content: `You've successfully opted out of the <@&${moderatorRoleId}> role.`,
                        ephemeral: true
                    });
                    break;
            }
        });
    });
}

async function deployCommands(token) {
    const rest = new REST({ version: "10" }).setToken(token);
    const commands = [
        new SlashCommandBuilder().setName("ping").setDescription("Replies with pong!").toJSON(),
        new SlashCommandBuilder().setName("post").setDescription("Manually posts the next plate in queue").toJSON(),
        new SlashCommandBuilder().setName("bio").setDescription("Updates the bot's bio").toJSON(),
        new SlashCommandBuilder().setName("review").setDescription("Review some plates").toJSON(),
        new SlashCommandBuilder().setName("queue").setDescription("Returns the plates in the queue").toJSON(),
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
    return !member.bot && member.roles.cache.has(moderatorRoleId);
}

function process() {
    return new Promise(async (resolve) => {
        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel("Let me review some plates")
                    .setStyle(ButtonStyle.Primary)
                    .setCustomId("review")
                    .setDisabled(false)
            );
        
        const message = await channel.send({
            components: [ buttons ],
            //remove these backslashes when deploying
            content: `\\<@&${moderatorRoleId}\\> The queue is empty and new plates need to be reviewed! </review:1251277993691709474>`
        });
        
        let opportunist = null;
        const collector = message.createMessageComponentCollector({ interactionFilter, time: 60 * 60 * 24 * 1000 });
        collector.on("collect", async (interaction) => {
            if (opportunist !== null)
                return;
            
            opportunist = channel.guild.members.cache.get(interaction.user.id);
            await message.edit({
                components: [],
                content: `~~${message.content}~~ <@${opportunist.id}> took the opportunity.`
            });
            
            const plates = await startReviewProcessForUser(interaction);
            resolve(plates);
        })
    })
}

async function optInForUser(interaction) {
    const tag = interaction.user.tag;
    const userid = interaction.user.id;
    
    console.log(`"${tag}" (${userid}) ran the opt-in command!`);
    
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
                    console.log(`"${tag}" (${userid}) opted in!`);
                    interaction.member.roles.add(moderatorRoleId);
                    await interaction.editReply({
                        content: `Thank you for agreeing to participate! You now have the <@&${moderatorRoleId}> role, and have access to the ${channel} channel.`,
                        components: [],
                        ephemeral: true
                    });
                    break;
                case "nevermind":
                    console.log(`"${tag}" (${userid}) had second thoughts about opting in.`);
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
    
    console.log(`"${tag}" (${userid}) started reviewing plates.`);
    
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
                        .setDisabled(approvedPlates.length === 0)
                );
            
            const examplePostText = util.format(bot.formats.post,
                plate.customerComment,
                plate.dmvComment,
                plate.verdict === true ? "ACCEPTED" :  plate.verdict === false ? "DENIED" : "(NOT ON RECORD)"
            ).replace(/\n<!--.+/g, "");
            
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
                    "files": []
                });
                
                switch (response.customId) {
                    case "approve":
                        console.log(`"${tag}" (${userid}) approved plate \`${plate.text}\`.`);
                        plate.approver = interaction.user;
                        app.addPlatesToQueue([plate]);
                        approvedPlates.push(plate);
                        updateStatus(app.getQueue().length);
                        await interaction.editReply(`**Approved \`${plate.text}\`.** Fetching next plate...`);
                        break;
                    case "disapprove":
                        console.log(`"${tag}" (${userid}) disapproved plate \`${plate.text}\`.`);
                        bot.removePlate(plate);
                        await interaction.editReply(`**Disapproved \`${plate.text}\`.** Fetching next plate...`);
                        break
                    case "finished":
                        console.log(`"${tag}" stopped reviewing plates.`);
                        isReviewing = false;
                        await interaction.editReply(`Stopped reviewing plates. You approved **${approvedPlates.length} plate${approvedPlates.length!==1?"s":""}.** You may always enter the command </review:1251277993691709474> to restart the review process and </queue:1251277993691709475> to see all plates in queue to be posted.`);
                        break;
                }
                
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
    const body = `Posting plate \`${plate.text}\`...${finished ? " finished!" : ""}\n`;
    
    for (const [service, url] of Object.entries(urls))
        body += `**${service}:** <${url}>\n`;
    
    await notification.edit(body);
}

async function notifyQueueAmount(queueAmount) {
    await channel.send(`There are **${queueAmount}** plate${queueAmount!==1?"s":""} left in the queue.`);
    
    if (queueAmount === 0)
        await process();
}

function updateStatus(queueAmount) {
    client.user.setPresence({ activities: [{ name: `${queueAmount} plate${queueAmount!==1?"s":""} left to be posted` }] });
}

export default {
    initialize,
    process,
    notify,
    updateNotification,
    notifyQueueAmount,
    updateStatus
};