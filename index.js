// Updated version of the EverQuest PoP Tracker Bot with Supabase integration
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
require('dotenv').config();
const SupabaseDB = require('./supabase-db'); // Import the Supabase module
// Add this near the top of your main bot file
const healthcheck = require('./healthcheck');

// Initialize health status
healthcheck.updateStatus({
  ready: false,
  lastPing: null,
  databaseConnected: false
});

// Define command enum to avoid magic strings
const CMD_TRACK_FLAG = 'pop-trackflag';
const CMD_RESET_FLAGS = 'pop-resetflags';
const CMD_PROGRESS = 'pop-progress';
const CMD_NEXT_STEPS = 'pop-nextsteps';
const CMD_GUILD_PROGRESS = 'pop-guildprogress';

// Initialize client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Define the flag progression structure for Planes of Power
const popFlags = {
  "knowledge": { name: "Plane of Knowledge", description: "Initial access to PoP content", dependsOn: [] },
  // Elemental Trials
  "smoke": { name: "Trial of Smoke", description: "Fire Elemental Trial", dependsOn: ["knowledge"] },
  "water": { name: "Trial of Water", description: "Water Elemental Trial", dependsOn: ["knowledge"] },
  "air": { name: "Trial of Air", description: "Air Elemental Trial", dependsOn: ["knowledge"] },
  "earth": { name: "Trial of Earth", description: "Earth Elemental Trial", dependsOn: ["knowledge"] },
  // Mid-tier Planes
  "innovation": { name: "Plane of Innovation", description: "Access to mechanical plane", dependsOn: ["knowledge"] },
  "tactics": { name: "Plane of Tactics", description: "Access to tactical combat plane", dependsOn: ["knowledge"] },
  "disease": { name: "Plane of Disease", description: "Access to plague-ridden plane", dependsOn: ["knowledge"] },
  "valor": { name: "Plane of Valor", description: "Access to warrior's plane", dependsOn: ["knowledge"] },
  // Seven Trials
  "hanging": { name: "Trial of Hanging", description: "Justice Trial", dependsOn: ["knowledge"] },
  "torture": { name: "Trial of Torture", description: "Justice Trial", dependsOn: ["knowledge"] },
  "efficiency": { name: "Trial of Efficiency", description: "Tranquility Trial", dependsOn: ["knowledge"] },
  "refreshment": { name: "Trial of Refreshment", description: "Tranquility Trial", dependsOn: ["knowledge"] },
  "speed": { name: "Trial of Speed", description: "Tranquility Trial", dependsOn: ["knowledge"] },
  "focus": { name: "Trial of Focus", description: "Solusek Ro Trial", dependsOn: ["knowledge"] },
  "projection": { name: "Trial of Projection", description: "Solusek Ro Trial", dependsOn: ["knowledge"] },
  // Upper Planes
  "storms": { name: "Plane of Storms", description: "Access to storm plane", 
    dependsOn: ["hanging", "torture", "efficiency", "refreshment", "speed", "focus", "projection"] },
  "timeA": { name: "Plane of Time A", description: "Access to Time phase 1", 
    dependsOn: ["storms", "smoke", "water", "air", "earth", "innovation", "tactics", "disease", "valor"] },
  "quarm": { name: "Plane of Time B (Quarm)", description: "Defeated the Gods in Time A to access Quarm", 
    dependsOn: ["timeA"] }
};

// Register slash commands
const commands = [
  new SlashCommandBuilder()
    .setName(CMD_TRACK_FLAG)
    .setDescription('Mark a PoP flag as completed')
    .addStringOption(option => 
      option.setName('flag')
        .setDescription('The flag to mark as completed')
        .setRequired(true)
        .addChoices(
          ...Object.entries(popFlags).map(([key, value]) => ({ name: value.name, value: key }))
        ))
    .addUserOption(option =>
      option.setName('player')
        .setDescription('The player to update (defaults to you)')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName(CMD_RESET_FLAGS)
    .setDescription('Reset all your PoP flags'),
    
  new SlashCommandBuilder()
    .setName(CMD_PROGRESS)
    .setDescription('View your PoP flag progress')
    .addUserOption(option =>
      option.setName('player')
        .setDescription('The player to check (defaults to you)')
        .setRequired(false)),
        
  new SlashCommandBuilder()
    .setName(CMD_NEXT_STEPS)
    .setDescription('See what flags you need to work on next')
    .addUserOption(option =>
      option.setName('player')
        .setDescription('The player to check (defaults to you)')
        .setRequired(false)),
        
  new SlashCommandBuilder()
    .setName(CMD_GUILD_PROGRESS)
    .setDescription('View server-wide progression through PoP content')
];

// Deploy slash commands when the bot starts
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  healthcheck.updateStatus({
    ready: true,
    lastPing: new Date().toISOString(),
    databaseConnected: global.healthStatus?.databaseConnected || false
  });
  
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  
  try {
    console.log('Refreshing application commands...');
    
    // First, delete all existing commands
    console.log('Deleting all existing commands...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [] }
    );
    
    // Then register the new commands
    console.log('Registering new commands...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    
    console.log('Successfully reloaded application commands.');
  } catch (error) {
    console.error(error);
  }
});

// Handle interactions
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;
  
  const { commandName } = interaction;
  
  // Defer reply for commands that might take longer to process
  if ([CMD_PROGRESS, CMD_NEXT_STEPS, CMD_GUILD_PROGRESS].includes(commandName)) {
    await interaction.deferReply();
  }
  
  const targetUser = interaction.options.getUser('player') || interaction.user;
  const userId = targetUser.id;
  const guildId = interaction.guild ? interaction.guild.id : 'dm';
  
  // Get the guild member object instead of using displayName directly
  let displayName = targetUser.username; // Default fallback
  
  // If this is in a guild context, try to get the member's nickname
  if (interaction.guild) {
    const member = interaction.options.getMember('player') || interaction.member;
    if (member) {
      displayName = member.nickname || member.displayName || targetUser.username;
    }
  }
  
  // Initialize player in database
  if (interaction.guild) {
    await SupabaseDB.initPlayer(userId, guildId, displayName);
  }
  
  switch (commandName) {
    case CMD_TRACK_FLAG: {
      const flagKey = interaction.options.getString('flag');
      
      // Check if the flag exists
      if (!popFlags[flagKey]) {
        await interaction.reply('Invalid flag specified.');
        return;
      }
      
      // Get current flags from database
      const playerFlags = await SupabaseDB.getPlayerFlags(userId, guildId);
      
      // Check if all dependent flags are completed
      const dependencies = popFlags[flagKey].dependsOn;
      const missingDeps = dependencies.filter(dep => !playerFlags[dep]);
      
      if (missingDeps.length > 0) {
        const missingNames = missingDeps.map(dep => popFlags[dep].name).join(', ');
        await interaction.reply(`Cannot complete this flag yet. Missing requirements: ${missingNames}`);
        return;
      }
      
      // Mark the flag as completed in the database
      await SupabaseDB.setFlag(userId, guildId, flagKey, true);
      
      await interaction.reply(`✅ ${displayName} has completed the flag: ${popFlags[flagKey].name}`);
      
      // Special message for completing Quarm
      if (flagKey === 'quarm') {
        await interaction.followUp(`🎉 **CONGRATULATIONS!** ${displayName} has completed the full Planes of Power progression and defeated Quarm!`);
      }
      break;
    }
    
    case CMD_RESET_FLAGS: {
      if (targetUser.id !== interaction.user.id) {
        await interaction.reply('You can only reset your own flags.');
        return;
      }
      
      // Reset all flags in database
      await SupabaseDB.resetFlags(userId, guildId);
      
      await interaction.reply('Your PoP flags have been reset. You now only have access to the Plane of Knowledge.');
      break;
    }
    
    case CMD_PROGRESS: {
      // Get flags from database
      const playerFlags = await SupabaseDB.getPlayerFlags(userId, guildId);
      const lastUpdated = await SupabaseDB.getLastUpdated(userId, guildId);
      
      // Create a progress embed
      const progressEmbed = new EmbedBuilder()
        .setTitle(`${displayName}'s Planes of Power Progress`)
        .setDescription('Flag progression towards Plane of Time')
        .setColor(0x0099FF)
        .setTimestamp(lastUpdated);
      
      // Group flags by category
      const categories = {
        "Elemental Trials": ["smoke", "water", "air", "earth"],
        "Mid-tier Planes": ["innovation", "tactics", "disease", "valor"],
        "Seven Trials": ["hanging", "torture", "efficiency", "refreshment", "speed", "focus", "projection"],
        "Upper Planes": ["storms", "timeA", "quarm"]
      };
      
      // Add fields for each category
      for (const [category, flags] of Object.entries(categories)) {
        const flagStatus = flags.map(flag => {
          const status = playerFlags[flag] ? '✅' : '❌';
          return `${status} ${popFlags[flag].name}`;
        }).join('\n');
        
        progressEmbed.addFields({ name: category, value: flagStatus, inline: false });
      }
      
      // Add progress percentage
      const totalFlags = Object.keys(popFlags).length;
      const completedFlags = Object.keys(playerFlags).filter(key => playerFlags[key]).length;
      const percentage = Math.floor((completedFlags / totalFlags) * 100);
      
      progressEmbed.setFooter({ text: `Overall Progress: ${percentage}% (${completedFlags}/${totalFlags})` });
      
      await interaction.editReply({ embeds: [progressEmbed] });
      break;
    }
    
    case CMD_NEXT_STEPS: {
      // Get flags from database
      const playerFlags = await SupabaseDB.getPlayerFlags(userId, guildId);
      
      // Find flags that can be completed next (all dependencies satisfied)
      const availableFlags = Object.entries(popFlags)
        .filter(([key, flag]) => {
          // Skip already completed flags
          if (playerFlags[key]) return false;
          
          // Check if all dependencies are met
          return flag.dependsOn.every(dep => playerFlags[dep]);
        })
        .map(([key, flag]) => `- **${flag.name}**: ${flag.description}`);
      
      if (availableFlags.length === 0) {
        if (playerFlags['quarm']) {
          await interaction.editReply('🎉 You have completed all Planes of Power content including Quarm!');
        } else {
          await interaction.editReply('No flags are currently available. Check your progress to see what requirements you need to meet first.');
        }
      } else {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(`${displayName}'s Next Available Flags`)
              .setDescription(availableFlags.join('\n'))
              .setColor(0x00FF00)
              .setTimestamp()
          ]
        });
      }
      break;
    }
    
    case CMD_GUILD_PROGRESS: {
      if (!interaction.guild) {
        await interaction.editReply('This command can only be used in a server.');
        return;
      }
      
      // Get guild progress from database
      const guildProgress = await SupabaseDB.getGuildProgress(guildId);
      
      if (guildProgress.length === 0) {
        await interaction.editReply('No players in this server have tracked any PoP flags yet.');
        return;
      }
      
      // Sort by number of flags completed (descending)
      guildProgress.sort((a, b) => b.flagsCompleted - a.flagsCompleted);
      
      const totalFlags = Object.keys(popFlags).length;
      const quarmSlayers = guildProgress.filter(p => p.quarmDefeated).length;
      
      // Create a nice embed
      const progressEmbed = new EmbedBuilder()
        .setTitle(`${interaction.guild.name} - Planes of Power Progress`)
        .setDescription(`Total Players Tracking: ${guildProgress.length} | Quarm Slayers: ${quarmSlayers}`)
        .setColor(0x7289DA)
        .setTimestamp();
      
      // Add top 10 players
      const topPlayers = guildProgress.slice(0, 10);
      const playerList = topPlayers.map((player, index) => {
        const percentage = Math.floor((player.flagsCompleted / totalFlags) * 100);
        const quarmStatus = player.quarmDefeated ? ' 👑' : '';
        return `${index + 1}. **${player.displayName}**${quarmStatus}: ${percentage}% (${player.flagsCompleted}/${totalFlags})`;
      }).join('\n');
      
      progressEmbed.addFields({ name: 'Top Players', value: playerList || 'No data available', inline: false });
      
      await interaction.editReply({ embeds: [progressEmbed] });
      break;
    }
  }
});

// Error handling
client.on('error', (error) => {
  console.error('Discord client error:', error);
  healthcheck.updateStatus({
    ...global.healthStatus,
    ready: false
  });
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);