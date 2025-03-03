// Supabase database integration for EverQuest PoP Tracker Bot
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Table schema to set up in Supabase:
/*
Table: player_flags
- id: uuid (primary key, auto-generated)
- user_id: text (Discord user ID)
- guild_id: text (Discord server ID)
- flag_key: text (flag identifier)
- completed: boolean
- completed_at: timestamp with time zone
- created_at: timestamp with time zone (default: now())

Table: player_data
- id: uuid (primary key, auto-generated)
- user_id: text (Discord user ID)
- guild_id: text (Discord server ID)
- display_name: text (user's display name)
- last_updated: timestamp with time zone
- created_at: timestamp with time zone (default: now())
*/

// Helper functions for database operations
const SupabaseDB = {
  // Initialize player in DB if they don't exist
  async initPlayer(userId, guildId, displayName) {
    const { data, error } = await supabase
      .from('player_data')
      .select('*')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
    
    if (error || !data) {
      // Create new player record
      const { error: insertError } = await supabase
        .from('player_data')
        .insert({
          user_id: userId,
          guild_id: guildId,
          display_name: displayName,
          last_updated: new Date().toISOString()
        });
      
      if (insertError) {
        console.error('Error creating player:', insertError);
        return false;
      }
      
      // Add knowledge flag by default
      await this.setFlag(userId, guildId, 'knowledge', true);
    } else {
      // Update display name if it changed
      if (data.display_name !== displayName) {
        await supabase
          .from('player_data')
          .update({ 
            display_name: displayName,
            last_updated: new Date().toISOString()
          })
          .eq('user_id', userId)
          .eq('guild_id', guildId);
      }
    }
    
    return true;
  },
  
  // Get all flag status for a player
  async getPlayerFlags(userId, guildId) {
    const { data, error } = await supabase
      .from('player_flags')
      .select('*')
      .eq('user_id', userId)
      .eq('guild_id', guildId);
    
    if (error) {
      console.error('Error fetching player flags:', error);
      return {};
    }
    
    // Convert to a simple object map for easier use
    const flags = {};
    data.forEach(flag => {
      flags[flag.flag_key] = flag.completed;
    });
    
    // Ensure knowledge flag exists
    if (!flags.knowledge) {
      flags.knowledge = true;
      this.setFlag(userId, guildId, 'knowledge', true);
    }
    
    return flags;
  },
  
  // Set flag status for a player
  async setFlag(userId, guildId, flagKey, completed) {
    // Check if flag already exists
    const { data, error } = await supabase
      .from('player_flags')
      .select('*')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .eq('flag_key', flagKey)
      .single();
    
    const timestamp = new Date().toISOString();
    
    if (error || !data) {
      // Create new flag
      const { error: insertError } = await supabase
        .from('player_flags')
        .insert({
          user_id: userId,
          guild_id: guildId,
          flag_key: flagKey,
          completed: completed,
          completed_at: completed ? timestamp : null
        });
      
      if (insertError) {
        console.error('Error setting flag:', insertError);
        return false;
      }
    } else {
      // Update existing flag
      const { error: updateError } = await supabase
        .from('player_flags')
        .update({ 
          completed: completed,
          completed_at: completed ? timestamp : null
        })
        .eq('user_id', userId)
        .eq('guild_id', guildId)
        .eq('flag_key', flagKey);
      
      if (updateError) {
        console.error('Error updating flag:', updateError);
        return false;
      }
    }
    
    // Update last_updated in player_data
    await supabase
      .from('player_data')
      .update({ last_updated: timestamp })
      .eq('user_id', userId)
      .eq('guild_id', guildId);
    
    return true;
  },
  
  // Reset all flags for a player
  async resetFlags(userId, guildId) {
    // Delete all flags except knowledge
    const { error } = await supabase
      .from('player_flags')
      .delete()
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .neq('flag_key', 'knowledge');
    
    if (error) {
      console.error('Error resetting flags:', error);
      return false;
    }
    
    // Ensure knowledge flag is set
    await this.setFlag(userId, guildId, 'knowledge', true);
    
    // Update last_updated in player_data
    await supabase
      .from('player_data')
      .update({ last_updated: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('guild_id', guildId);
    
    return true;
  },
  
  // Get player's last updated timestamp
  async getLastUpdated(userId, guildId) {
    const { data, error } = await supabase
      .from('player_data')
      .select('last_updated')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
    
    if (error || !data) {
      return new Date();
    }
    
    return new Date(data.last_updated);
  },
  
  // Get all players in a guild with completed flags count
  async getGuildProgress(guildId) {
    // Get all players in the guild
    const { data: players, error: playerError } = await supabase
      .from('player_data')
      .select('*')
      .eq('guild_id', guildId);
    
    if (playerError) {
      console.error('Error fetching guild players:', playerError);
      return [];
    }
    
    // Get all flags for all users in the guild
    const { data: flags, error: flagError } = await supabase
      .from('player_flags')
      .select('*')
      .eq('guild_id', guildId)
      .eq('completed', true);
    
    if (flagError) {
      console.error('Error fetching guild flags:', flagError);
      return [];
    }
    
    // Group flags by user
    const flagsByUser = {};
    flags.forEach(flag => {
      if (!flagsByUser[flag.user_id]) {
        flagsByUser[flag.user_id] = [];
      }
      flagsByUser[flag.user_id].push(flag.flag_key);
    });
    
    // Combine data
    return players.map(player => {
      const userFlags = flagsByUser[player.user_id] || ['knowledge'];
      return {
        userId: player.user_id,
        displayName: player.display_name,
        lastUpdated: player.last_updated,
        flagsCompleted: userFlags.length,
        quarmDefeated: userFlags.includes('quarm')
      };
    });
  }
};

module.exports = SupabaseDB;