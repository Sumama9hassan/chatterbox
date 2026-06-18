import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { Avatar } from '../components/Avatar';
import { Search, MessageSquare, Check, X, History, Loader2, Ban } from 'lucide-react';

interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  is_private: boolean;
}

interface SearchTabProps {
  currentUserId: string;
  onNavigateToChat: (convoId: string) => void;
}

export const SearchTab: React.FC<SearchTabProps> = ({ currentUserId, onNavigateToChat }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  
  // Profile Modal
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockingAction, setBlockingAction] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);

  const debounceTimer = useRef<any>(null);

  // 1. Load recent searches
  useEffect(() => {
    const saved = localStorage.getItem('recent_searches');
    if (saved) {
      try {
        setRecentSearches(JSON.parse(saved));
      } catch (e) {
        setRecentSearches([]);
      }
    }
  }, []);

  const addRecentSearch = (query: string) => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return;
    
    const updated = [trimmed, ...recentSearches.filter(q => q !== trimmed)].slice(0, 5);
    setRecentSearches(updated);
    localStorage.setItem('recent_searches', JSON.stringify(updated));
  };

  const removeRecentSearch = (query: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = recentSearches.filter(q => q !== query);
    setRecentSearches(updated);
    localStorage.setItem('recent_searches', JSON.stringify(updated));
  };

  // 2. Perform Search
  const performSearch = async (query: string) => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      // Fetch users we blocked
      const { data: blockedList } = await supabase
        .from('blocks')
        .select('blocked_id')
        .eq('blocker_id', currentUserId);
        
      const blockedUserIds = (blockedList || []).map(b => b.blocked_id);

      // Query profiles matching username
      // RLS policy handles: (is_private=false AND no blocks)
      // So we can search public users.
      let queryBuilder = supabase
        .from('users')
        .select('*')
        .ilike('username', `%${query.trim().toLowerCase()}%`)
        .neq('id', currentUserId) // exclude self
        .eq('is_private', false)
        .limit(20);

      // Exclude users we already blocked
      if (blockedUserIds.length > 0) {
        queryBuilder = queryBuilder.not('id', 'in', `(${blockedUserIds.join(',')})`);
      }

      const { data, error } = await queryBuilder;

      if (error) throw error;
      setResults(data || []);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Debounced typing search
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    if (!searchQuery.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceTimer.current = setTimeout(() => {
      performSearch(searchQuery);
      addRecentSearch(searchQuery);
    }, 400);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchQuery]);

  // 3. Block Status check on modal open
  const checkBlockStatus = async (user: UserProfile) => {
    try {
      const { data, error } = await supabase
        .from('blocks')
        .select('id')
        .eq('blocker_id', currentUserId)
        .eq('blocked_id', user.id)
        .maybeSingle();

      if (error) throw error;
      setIsBlocked(!!data);
    } catch (err) {
      console.error('Error checking block status:', err);
    }
  };

  useEffect(() => {
    if (selectedUser) {
      checkBlockStatus(selectedUser);
    }
  }, [selectedUser]);

  // 4. Block/Unblock actions
  const handleToggleBlock = async () => {
    if (!selectedUser) return;
    setBlockingAction(true);
    try {
      if (isBlocked) {
        // Unblock
        const { error } = await supabase
          .from('blocks')
          .delete()
          .eq('blocker_id', currentUserId)
          .eq('blocked_id', selectedUser.id);
        
        if (error) throw error;
        setIsBlocked(false);
      } else {
        // Block
        const { error } = await supabase
          .from('blocks')
          .insert({
            blocker_id: currentUserId,
            blocked_id: selectedUser.id,
            reason: 'Blocked from Search profile card'
          });

        if (error) throw error;
        setIsBlocked(true);
        // Remove from current results list
        setResults(prev => prev.filter(u => u.id !== selectedUser.id));
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setBlockingAction(false);
    }
  };

  // 5. Start Chat
  const handleStartChat = async () => {
    if (!selectedUser) return;
    setCreatingChat(true);
    try {
      // Enforce lower UUID = participant_a, higher UUID = participant_b
      const partA = currentUserId < selectedUser.id ? currentUserId : selectedUser.id;
      const partB = currentUserId < selectedUser.id ? selectedUser.id : currentUserId;

      // 1. Check if conversation already exists
      const { data: existing, error: fetchError } = await supabase
        .from('conversations')
        .select('id')
        .eq('participant_a', partA)
        .eq('participant_b', partB)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (existing) {
        onNavigateToChat(existing.id);
        setSelectedUser(null);
        return;
      }

      // 2. Create new conversation
      const { data: newConvo, error: createError } = await supabase
        .from('conversations')
        .insert({
          participant_a: partA,
          participant_b: partB,
          is_random_chat: false
        })
        .select('id')
        .single();

      if (createError) throw createError;

      // Insert system join message
      await supabase.from('messages').insert({
        conversation_id: newConvo.id,
        sender_id: currentUserId,
        content_type: 'system',
        content: 'Conversation started! Say hello.'
      });

      onNavigateToChat(newConvo.id);
      setSelectedUser(null);
    } catch (err: any) {
      alert(`Could not start chat: ${err.message}`);
    } finally {
      setCreatingChat(false);
    }
  };

  return (
    <div className="tab-container">
      <div className="tab-header">
        <h2 className="tab-title">Search</h2>
      </div>

      <div className="tab-body">
        {/* Search Bar */}
        <div className="search-input-wrapper">
          <Search className="search-icon" size={18} />
          <input
            type="text"
            className="search-input"
            placeholder="Search by username..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {loading && (
            <Loader2 className="spinner" size={16} style={{ position: 'absolute', right: 14, color: 'var(--text-muted)' }} />
          )}
        </div>

        {/* Recent Searches */}
        {!searchQuery.trim() && recentSearches.length > 0 && (
          <div style={{ marginTop: '20px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <History size={14} /> RECENT SEARCHES
            </span>
            <div className="flex flex-column gap-2">
              {recentSearches.map((query) => (
                <div 
                  key={query}
                  className="nav-item"
                  style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-card)' }}
                  onClick={() => setSearchQuery(query)}
                >
                  <span>{query}</span>
                  <button 
                    style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                    onClick={(e) => removeRecentSearch(query, e)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Results list */}
        {searchQuery.trim() && (
          <div className="search-results-list">
            {results.length === 0 && !loading ? (
              <div className="text-center" style={{ padding: '40px 0', color: 'var(--text-muted)' }}>
                <p>No users found. Try a different username.</p>
              </div>
            ) : (
              results.map((user) => (
                <div 
                  key={user.id} 
                  className="search-result-row"
                  onClick={() => setSelectedUser(user)}
                >
                  <Avatar src={user.avatar_url} name={user.display_name} />
                  <div className="user-info">
                    <span className="user-name">{user.display_name}</span>
                    <span className="user-handle">@{user.username}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Public Profile Modal */}
      {selectedUser && (
        <div className="modal-overlay" onClick={() => setSelectedUser(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">User Profile</div>
              <button 
                className="input-action-btn" 
                onClick={() => setSelectedUser(null)}
                style={{ width: '30px', height: '30px' }}
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="modal-body profile-card-content">
              <Avatar 
                src={selectedUser.avatar_url} 
                name={selectedUser.display_name} 
                size={90}
              />
              
              <div className="profile-card-name">{selectedUser.display_name}</div>
              <div className="profile-card-username">@{selectedUser.username}</div>
              
              <div className="profile-card-bio">
                {selectedUser.bio || "No profile biography written yet."}
              </div>
            </div>

            <div className="modal-footer" style={{ justifyContent: 'center', gap: '12px' }}>
              <button 
                className="btn btn-primary"
                onClick={handleStartChat}
                disabled={creatingChat || isBlocked}
                style={{ flexGrow: 1 }}
              >
                {creatingChat ? (
                  <Loader2 className="spinner" size={16} />
                ) : (
                  <>
                    <MessageSquare size={16} /> Send Message
                  </>
                )}
              </button>
              
              <button 
                className={isBlocked ? 'btn btn-secondary' : 'btn btn-danger'}
                onClick={handleToggleBlock}
                disabled={blockingAction}
                style={{ minWidth: '120px' }}
              >
                {blockingAction ? (
                  <Loader2 className="spinner" size={16} />
                ) : isBlocked ? (
                  <>
                    <Check size={16} /> Unblock User
                  </>
                ) : (
                  <>
                    <Ban size={16} /> Block User
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
