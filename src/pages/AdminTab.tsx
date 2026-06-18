import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { Avatar } from '../components/Avatar';
import { 
  Shield, Trash2, Users, MessageSquare, Sparkles, 
  TrendingUp, UserCheck, UserX, Loader2, Search, Trash
} from 'lucide-react';

interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
  is_admin: boolean;
  created_at: string;
}

interface ActiveStory {
  id: string;
  text_content: string;
  bg_color: string;
  font_color: string;
  font_style: 'normal' | 'bold' | 'italic';
  created_at: string;
  expires_at: string;
  user: {
    username: string;
    display_name: string;
    avatar_url: string | null;
  };
}

interface AdminTabProps {
  currentUserId: string;
}

export const AdminTab: React.FC<AdminTabProps> = ({ currentUserId }) => {
  // Stats
  const [stats, setStats] = useState({
    usersCount: 0,
    messagesCount: 0,
    storiesCount: 0,
    queueCount: 0
  });
  const [statsLoading, setStatsLoading] = useState(true);

  // Tabs inside Admin Panel
  const [subTab, setSubTab] = useState<'users' | 'stories'>('users');

  // Users management
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionUserId, setActionUserId] = useState<string | null>(null); // spinner target

  // Stories moderation
  const [storiesList, setStoriesList] = useState<ActiveStory[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);

  useEffect(() => {
    fetchStats();
    if (subTab === 'users') {
      fetchUsers();
    } else {
      fetchStories();
    }
  }, [subTab]);

  const fetchStats = async () => {
    setStatsLoading(true);
    try {
      // Fetch users count
      const { count: usersCount, error: uErr } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true });
        
      // Fetch messages count
      const { count: messagesCount, error: mErr } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true });

      // Fetch active stories count
      const { count: storiesCount, error: sErr } = await supabase
        .from('statuses')
        .select('*', { count: 'exact', head: true })
        .gt('expires_at', new Date().toISOString());

      // Fetch matchmaking queue size
      const { count: queueCount, error: qErr } = await supabase
        .from('matchmaking_queue')
        .select('*', { count: 'exact', head: true });

      if (uErr || mErr || sErr || qErr) {
        console.error('Error fetching statistics counts');
      }

      setStats({
        usersCount: usersCount || 0,
        messagesCount: messagesCount || 0,
        storiesCount: storiesCount || 0,
        queueCount: queueCount || 0
      });
    } catch (err) {
      console.error('Stats error:', err);
    } finally {
      setStatsLoading(false);
    }
  };

  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, username, display_name, email, avatar_url, is_admin, created_at')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsersList(data || []);
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setUsersLoading(false);
    }
  };

  const fetchStories = async () => {
    setStoriesLoading(true);
    try {
      const { data, error } = await supabase
        .from('statuses')
        .select(`
          id, text_content, bg_color, font_color, font_style, created_at, expires_at,
          user:user_id (username, display_name, avatar_url)
        `)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;
      setStoriesList((data as any) || []);
    } catch (err) {
      console.error('Error fetching active stories:', err);
    } finally {
      setStoriesLoading(false);
    }
  };

  const handleToggleAdmin = async (user: UserProfile) => {
    if (user.id === currentUserId) {
      alert('You cannot revoke admin status from yourself.');
      return;
    }

    setActionUserId(user.id);
    try {
      const targetAdminState = !user.is_admin;
      const { error } = await supabase
        .from('users')
        .update({ is_admin: targetAdminState })
        .eq('id', user.id);

      if (error) throw error;

      setUsersList(prev => prev.map(u => u.id === user.id ? { ...u, is_admin: targetAdminState } : u));
      fetchStats();
    } catch (err: any) {
      alert(`Failed to update admin role: ${err.message}`);
    } finally {
      setActionUserId(null);
    }
  };

  const handleDeleteUser = async (user: UserProfile) => {
    if (user.id === currentUserId) {
      alert('You cannot delete your own account from the Admin Panel. Use the Settings tab instead.');
      return;
    }

    if (!confirm(`Are you absolutely sure you want to delete @${user.username} (${user.display_name})?\nThis will permanently delete all their chats, messages, files, and auth records.`)) {
      return;
    }

    setActionUserId(user.id);
    try {
      const { error } = await supabase.rpc('admin_delete_user', { target_user_id: user.id });
      if (error) throw error;

      setUsersList(prev => prev.filter(u => u.id !== user.id));
      fetchStats();
      alert('User deleted successfully.');
    } catch (err: any) {
      alert(`Failed to delete user: ${err.message}`);
    } finally {
      setActionUserId(null);
    }
  };

  const handleDeleteStory = async (storyId: string) => {
    if (!confirm('Are you sure you want to delete this status story?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('statuses')
        .delete()
        .eq('id', storyId);

      if (error) throw error;

      setStoriesList(prev => prev.filter(s => s.id !== storyId));
      fetchStats();
    } catch (err: any) {
      alert(`Failed to delete story: ${err.message}`);
    }
  };

  // Filter users based on query
  const filteredUsers = usersList.filter(u => 
    u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="tab-container flex flex-column h-full overflow-hidden" style={{ height: '100%' }}>
      <div className="tab-header flex justify-between align-center" style={{ borderBottom: '1px solid var(--border-color)', padding: '20px' }}>
        <div className="flex align-center gap-2">
          <Shield className="text-primary" size={24} style={{ color: 'var(--primary)' }} />
          <h1 className="tab-title" style={{ margin: 0 }}>Admin Dashboard</h1>
        </div>
      </div>

      <div className="tab-body grow overflow-y-auto" style={{ padding: '24px' }}>
        {/* Statistics Grid */}
        {statsLoading ? (
          <div className="text-center" style={{ padding: '20px' }}>
            <Loader2 className="spinner" size={24} style={{ margin: 'auto' }} />
          </div>
        ) : (
          <div className="grid grid-4 gap-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
            <div className="card text-center" style={{ padding: '20px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
              <Users size={24} style={{ color: 'var(--primary)', margin: '0 auto 10px' }} />
              <div style={{ fontSize: '28px', fontWeight: 800 }}>{stats.usersCount}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, marginTop: '4px' }}>Total Registered Users</div>
            </div>

            <div className="card text-center" style={{ padding: '20px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
              <MessageSquare size={24} style={{ color: 'var(--accent-purple)', margin: '0 auto 10px' }} />
              <div style={{ fontSize: '28px', fontWeight: 800 }}>{stats.messagesCount}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, marginTop: '4px' }}>Total Messages Sent</div>
            </div>

            <div className="card text-center" style={{ padding: '20px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
              <Sparkles size={24} style={{ color: '#ff5f6d', margin: '0 auto 10px' }} />
              <div style={{ fontSize: '28px', fontWeight: 800 }}>{stats.storiesCount}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, marginTop: '4px' }}>Active Stories (24h)</div>
            </div>

            <div className="card text-center" style={{ padding: '20px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
              <TrendingUp size={24} style={{ color: '#11998e', margin: '0 auto 10px' }} />
              <div style={{ fontSize: '28px', fontWeight: 800 }}>{stats.queueCount}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, marginTop: '4px' }}>In Matchmaking Queue</div>
            </div>
          </div>
        )}

        {/* Tab switch */}
        <div className="flex gap-2" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', marginBottom: '20px' }}>
          <button 
            className={`btn ${subTab === 'users' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSubTab('users')}
          >
            Manage Users
          </button>
          <button 
            className={`btn ${subTab === 'stories' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSubTab('stories')}
          >
            Moderate Stories
          </button>
        </div>

        {/* Tab Contents */}
        {subTab === 'users' ? (
          <div>
            {/* Search filter */}
            <div className="search-input-wrapper" style={{ maxWidth: '400px', marginBottom: '20px', position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={18} style={{ position: 'absolute', left: '12px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search username, display name, or email..."
                className="form-input"
                style={{ paddingLeft: '38px', width: '100%' }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {usersLoading ? (
              <div className="text-center" style={{ padding: '40px' }}>
                <Loader2 className="spinner" size={24} style={{ margin: 'auto' }} />
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center" style={{ padding: '40px', color: 'var(--text-muted)' }}>
                No users found.
              </div>
            ) : (
              <div className="table-container" style={{ overflowX: 'auto', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', fontSize: '13px', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '16px' }}>User</th>
                      <th style={{ padding: '16px' }}>Email</th>
                      <th style={{ padding: '16px' }}>Registered</th>
                      <th style={{ padding: '16px' }}>Admin Role</th>
                      <th style={{ padding: '16px', textRight: 'true' } as any}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map(user => (
                      <tr key={user.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '16px' }}>
                          <div className="flex align-center gap-2">
                            <Avatar src={user.avatar_url} name={user.display_name} />
                            <div className="flex flex-column">
                              <span style={{ fontWeight: 600, fontSize: '14.5px' }}>{user.display_name}</span>
                              <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>@{user.username}</span>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '16px', fontSize: '14px' }}>{user.email}</td>
                        <td style={{ padding: '16px', fontSize: '13.5px', color: 'var(--text-muted)' }}>
                          {new Date(user.created_at).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '16px' }}>
                          {user.is_admin ? (
                            <span className="badge" style={{ backgroundColor: 'rgba(63, 140, 255, 0.1)', color: 'var(--primary)', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>Admin</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '13.5px' }}>Standard</span>
                          )}
                        </td>
                        <td style={{ padding: '16px' }}>
                          <div className="flex gap-2 justify-end">
                            <button
                              className={`btn ${user.is_admin ? 'btn-secondary' : 'btn-primary'}`}
                              style={{ padding: '6px 12px', fontSize: '12px' }}
                              disabled={actionUserId !== null}
                              onClick={() => handleToggleAdmin(user)}
                            >
                              {actionUserId === user.id ? (
                                <Loader2 className="spinner" size={14} />
                              ) : user.is_admin ? (
                                <><UserX size={14} /> Demote</>
                              ) : (
                                <><UserCheck size={14} /> Promote</>
                              )}
                            </button>
                            
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '6px 12px', fontSize: '12px', color: 'var(--danger)', borderColor: 'var(--danger)' }}
                              disabled={actionUserId !== null}
                              onClick={() => handleDeleteUser(user)}
                            >
                              {actionUserId === user.id ? (
                                <Loader2 className="spinner" size={14} />
                              ) : (
                                <><Trash2 size={14} /> Delete</>
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div>
            {storiesLoading ? (
              <div className="text-center" style={{ padding: '40px' }}>
                <Loader2 className="spinner" size={24} style={{ margin: 'auto' }} />
              </div>
            ) : storiesList.length === 0 ? (
              <div className="text-center" style={{ padding: '40px', color: 'var(--text-muted)' }}>
                No active status stories in the last 24 hours.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '20px' }}>
                {storiesList.map(story => (
                  <div 
                    key={story.id} 
                    className="card flex flex-column" 
                    style={{ 
                      backgroundColor: 'var(--bg-card)', 
                      border: '1px solid var(--border-color)', 
                      borderRadius: 'var(--radius-lg)',
                      overflow: 'hidden'
                    }}
                  >
                    {/* Story Preview Card Header (User metadata) */}
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div className="flex align-center gap-2">
                        <Avatar src={story.user?.avatar_url} name={story.user?.display_name || 'Deleted User'} />
                        <div className="flex flex-column">
                          <span style={{ fontWeight: 600, fontSize: '13px' }}>{story.user?.display_name || 'Deleted'}</span>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>@{story.user?.username || 'deleted'}</span>
                        </div>
                      </div>
                      
                      <button 
                        className="input-action-btn"
                        style={{ color: 'var(--danger)' }}
                        onClick={() => handleDeleteStory(story.id)}
                      >
                        <Trash size={16} />
                      </button>
                    </div>

                    {/* Story Style Preview */}
                    <div 
                      style={{ 
                        backgroundColor: story.bg_color,
                        color: story.font_color || '#ffffff',
                        fontWeight: story.font_style === 'bold' ? 'bold' : 'normal',
                        fontStyle: story.font_style === 'italic' ? 'italic' : 'normal',
                        padding: '30px 20px',
                        minHeight: '140px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center',
                        fontSize: '16px',
                        wordBreak: 'break-word'
                      }}
                    >
                      {story.text_content}
                    </div>

                    {/* Footer Info */}
                    <div style={{ padding: '10px 16px', fontSize: '11.5px', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', textAlign: 'right' }}>
                      Expires: {new Date(story.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({new Date(story.expires_at).toLocaleDateString()})
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
