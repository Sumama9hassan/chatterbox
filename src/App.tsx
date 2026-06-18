import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { AuthPage } from './pages/AuthPage';
import { HomeTab } from './pages/HomeTab';
import { SearchTab } from './pages/SearchTab';
import { StatusTab } from './pages/StatusTab';
import { SettingsTab } from './pages/SettingsTab';
import { RandomChatTab } from './pages/RandomChatTab';
import { Avatar } from './components/Avatar';
import { 
  MessageSquare, Search, Sparkles, Settings, 
  Loader2, LogOut, Users, Shield
} from 'lucide-react';
import { AdminTab } from './pages/AdminTab';
import './App.css';

interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
  bio: string | null;
  is_private: boolean;
  theme_preference: string;
  is_admin: boolean;
}

function App() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  // App Profile
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  
  // Navigation
  const [activeTab, setActiveTab] = useState<'chats' | 'search' | 'status' | 'settings' | 'random' | 'admin'>('chats');
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  
  // Theme state
  const [themeMode, setThemeMode] = useState('system');

  // 1. Monitor Auth State Changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
      if (session) fetchUserProfile(session.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setAuthLoading(false);
      if (session) {
        fetchUserProfile(session.user.id);
      } else {
        setUserProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // 2. Fetch User Profile from DB
  const fetchUserProfile = async (userId: string) => {
    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        // If profile doesn't exist yet, it will be created by trigger.
        // Wait 1.5s and retry once
        setTimeout(async () => {
          const { data: retryData } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();
          if (retryData) {
            setUserProfile(retryData);
            applyTheme(retryData.theme_preference);
            setThemeMode(retryData.theme_preference);
          }
        }, 1500);
      } else if (data) {
        setUserProfile(data);
        applyTheme(data.theme_preference);
        setThemeMode(data.theme_preference);
      }
    } catch (err) {
      console.error('Profile fetch error:', err);
    } finally {
      setProfileLoading(false);
    }
  };

  // 3. Online Presence Sync
  useEffect(() => {
    if (!session || !userProfile) return;

    // Track user online status via database update
    const setOnlineStatus = async (onlineVal: boolean) => {
      try {
        await supabase
          .from('users')
          .update({ 
            is_online: onlineVal,
            last_seen_at: new Date().toISOString() 
          })
          .eq('id', session.user.id);
      } catch (e) {
        // ignore
      }
    };

    setOnlineStatus(true);

    // Set online status to false on unmount / visibility change
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setOnlineStatus(true);
      } else {
        setOnlineStatus(false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Periodically send heartbeat update (presence sync)
    const presenceHeartbeat = setInterval(() => {
      setOnlineStatus(true);
    }, 60000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(presenceHeartbeat);
      setOnlineStatus(false);
    };
  }, [session, userProfile]);

  // 4. Apply Theme Preference Helper
  const applyTheme = (themePref: string) => {
    const root = document.documentElement;
    if (themePref === 'dark') {
      root.classList.add('dark-theme');
    } else if (themePref === 'light') {
      root.classList.remove('dark-theme');
    } else {
      // System theme
      const matchesDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (matchesDark) {
        root.classList.add('dark-theme');
      } else {
        root.classList.remove('dark-theme');
      }
    }
  };

  // Listen for system theme change events if on 'system' mode
  useEffect(() => {
    if (themeMode !== 'system') return;
    
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => applyTheme('system');
    
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [themeMode]);

  const handleNavigateToChat = (convoId: string) => {
    setActiveTab('chats');
    setActiveConvoId(convoId);
  };

  if (authLoading || (session && !userProfile && profileLoading)) {
    return (
      <div style={{ display: 'flex', width: '100vw', height: '100vh', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-app)' }}>
        <div className="text-center">
          <Loader2 className="spinner" size={36} style={{ color: 'var(--primary)', margin: 'auto' }} />
          <p style={{ marginTop: '16px', color: 'var(--text-secondary)', fontWeight: 500 }}>Connecting to ChatterBox...</p>
        </div>
      </div>
    );
  }

  // Not Logged In -> Show Auth
  if (!session) {
    return <AuthPage onAuthSuccess={() => fetchUserProfile(supabase.auth.getUser() as any)} />;
  }

  return (
    <div className="app-container">
      
      {/* DESKTOP SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand-title">ChatterBox</div>
        </div>

        <nav className="sidebar-nav">
          <button 
            className={`nav-item ${activeTab === 'chats' ? 'active' : ''}`}
            onClick={() => setActiveTab('chats')}
          >
            <MessageSquare size={18} />
            <span>Chats</span>
          </button>
          
          <button 
            className={`nav-item ${activeTab === 'search' ? 'active' : ''}`}
            onClick={() => setActiveTab('search')}
          >
            <Search size={18} />
            <span>Search</span>
          </button>

          <button 
            className={`nav-item ${activeTab === 'status' ? 'active active-purple' : ''}`}
            onClick={() => setActiveTab('status')}
          >
            <Sparkles size={18} />
            <span>Status</span>
          </button>

          <button 
            className={`nav-item ${activeTab === 'random' ? 'active' : ''}`}
            onClick={() => setActiveTab('random')}
          >
            <Users size={18} />
            <span>Random Chat</span>
          </button>

          <button 
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>

          {userProfile?.is_admin && (
            <button 
              className={`nav-item ${activeTab === 'admin' ? 'active active-purple' : ''}`}
              onClick={() => setActiveTab('admin')}
            >
              <Shield size={18} />
              <span>Admin Panel</span>
            </button>
          )}
        </nav>

        {/* Sidebar user footer info */}
        {userProfile && (
          <div className="sidebar-footer">
            <div className="user-badge">
              <Avatar src={userProfile.avatar_url} name={userProfile.display_name} />
              <div className="user-info">
                <span className="user-name">{userProfile.display_name}</span>
                <span className="user-handle">@{userProfile.username}</span>
              </div>
            </div>
            
            <button 
              className="input-action-btn" 
              title="Log Out"
              onClick={() => supabase.auth.signOut().then(() => setUserProfile(null))}
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </aside>

      {/* MOBILE BOTTOM NAVIGATION */}
      <nav className="mobile-nav">
        <button 
          className={`mobile-nav-item ${activeTab === 'chats' ? 'active' : ''}`}
          onClick={() => setActiveTab('chats')}
        >
          <MessageSquare size={20} />
          <span>Chats</span>
        </button>

        <button 
          className={`mobile-nav-item ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveTab('search')}
        >
          <Search size={20} />
          <span>Search</span>
        </button>

        <button 
          className={`mobile-nav-item ${activeTab === 'status' ? 'active' : ''}`}
          onClick={() => setActiveTab('status')}
        >
          <Sparkles size={20} />
          <span>Status</span>
        </button>

        <button 
          className={`mobile-nav-item ${activeTab === 'random' ? 'active' : ''}`}
          onClick={() => setActiveTab('random')}
        >
          <Users size={20} />
          <span>Random</span>
        </button>

        <button 
          className={`mobile-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <Settings size={20} />
          <span>Settings</span>
        </button>

        {userProfile?.is_admin && (
          <button 
            className={`mobile-nav-item ${activeTab === 'admin' ? 'active' : ''}`}
            onClick={() => setActiveTab('admin')}
          >
            <Shield size={20} />
            <span>Admin</span>
          </button>
        )}
      </nav>

      {/* MAIN CONTENT WORKSPACE */}
      <main className="main-content">
        {activeTab === 'chats' && (
          <HomeTab 
            currentUserId={session.user.id} 
            initialConversationId={activeConvoId}
            onClearInitialConversation={() => setActiveConvoId(null)}
          />
        )}
        
        {activeTab === 'search' && (
          <SearchTab 
            currentUserId={session.user.id} 
            onNavigateToChat={handleNavigateToChat}
          />
        )}
        
        {activeTab === 'status' && (
          <StatusTab currentUserId={session.user.id} />
        )}

        {activeTab === 'random' && (
          <RandomChatTab currentUserId={session.user.id} />
        )}

        {activeTab === 'settings' && (
          <SettingsTab 
            currentUserId={session.user.id} 
            userProfile={userProfile} 
            onProfileUpdate={() => fetchUserProfile(session.user.id)}
            onLogout={() => setUserProfile(null)}
          />
        )}

        {activeTab === 'admin' && userProfile?.is_admin && (
          <AdminTab currentUserId={session.user.id} />
        )}
      </main>

    </div>
  );
}

export default App;
