import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { Avatar } from '../components/Avatar';
import { Plus, X, Eye, Play, Pause, Loader2, Send } from 'lucide-react';

interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

interface StatusStory {
  id: string;
  user_id: string;
  text_content: string;
  bg_color: string;
  font_color: string;
  font_style: 'normal' | 'bold' | 'italic';
  view_count: number;
  expires_at: string;
  created_at: string;
  user?: UserProfile;
}

interface UserGroupedStories {
  user: UserProfile;
  stories: StatusStory[];
  hasUnread: boolean;
}

interface StatusTabProps {
  currentUserId: string;
}

export const StatusTab: React.FC<StatusTabProps> = ({ currentUserId }) => {
  const [groupedStories, setGroupedStories] = useState<UserGroupedStories[]>([]);
  const [myStories, setMyStories] = useState<StatusStory[]>([]);
  const [loading, setLoading] = useState(true);

  // Status Creation Overlay
  const [showCreator, setShowCreator] = useState(false);
  const [textContent, setTextContent] = useState('');
  const [activeBg, setActiveBg] = useState('#3f8cff');
  const [activeStyle, setActiveStyle] = useState<'normal' | 'bold' | 'italic'>('normal');
  const [posting, setPosting] = useState(false);

  // Status Viewer Carousel Overlay
  const [viewerGroupIndex, setViewerGroupIndex] = useState<number | null>(null); // Index of UserGroupedStories being viewed
  const [viewerStoryIndex, setViewerStoryIndex] = useState<number>(0); // Index of specific story in that group
  const [viewerProgress, setViewerProgress] = useState(0);
  const [viewerPaused, setViewerPaused] = useState(false);
  
  // Seen-by list overlay (for own stories)
  const [showSeenBy, setShowSeenBy] = useState<string | null>(null); // Status ID to show seen users
  const [seenUsersList, setSeenUsersList] = useState<any[]>([]);
  const [loadingSeenBy, setLoadingSeenBy] = useState(false);

  const progressIntervalRef = useRef<any>(null);
  const touchStartRef = useRef<number>(0);

  const COLOR_PALETTE = [
    '#3f8cff', // Electric Blue
    '#aa3bff', // Violet Purple
    '#ff5f6d', // Coral Pink
    '#11998e', // Emerald Teal
    '#f1c40f', // Sun Yellow
    '#e74c3c', // Alizarin Red
    '#2c3e50', // Midnight Charcoal
    '#1abc9c', // Turquoise Mint
    '#fd79a8', // Pastel Rose
    '#27ae60', // Nephrite Green
  ];

  // 1. Fetch active statuses & group them by user
  const fetchStatuses = async () => {
    setLoading(true);
    try {
      // Fetch statuses that have not expired
      const { data, error } = await supabase
        .from('statuses')
        .select('*')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: true });

      if (error) throw error;

      const storiesList: StatusStory[] = data || [];

      // Get user profiles for each story
      const enhancedStories = await Promise.all(
        storiesList.map(async (story) => {
          const { data: user } = await supabase
            .from('users')
            .select('id, username, display_name, avatar_url')
            .eq('id', story.user_id)
            .single();
          
          return {
            ...story,
            user: user || {
              id: story.user_id,
              username: 'unknown_user',
              display_name: 'Unknown User',
              avatar_url: null
            }
          };
        })
      );

      // Get status views for the current user
      const { data: views } = await supabase
        .from('status_views')
        .select('status_id')
        .eq('viewer_id', currentUserId);

      const viewedStatusIds = new Set((views || []).map(v => v.status_id));

      // Separate my stories from others
      const myStoryList = enhancedStories.filter(s => s.user_id === currentUserId);
      setMyStories(myStoryList);

      // Group others' stories by user
      const otherStories = enhancedStories.filter(s => s.user_id !== currentUserId);
      const groupsMap: Record<string, { user: UserProfile, stories: StatusStory[] }> = {};

      otherStories.forEach((story) => {
        if (!groupsMap[story.user_id]) {
          groupsMap[story.user_id] = {
            user: story.user!,
            stories: []
          };
        }
        groupsMap[story.user_id].stories.push(story);
      });

      const grouped: UserGroupedStories[] = Object.values(groupsMap).map(g => {
        // Check if there are any unread stories
        const hasUnread = g.stories.some(s => !viewedStatusIds.has(s.id));
        
        // Sort stories so unread ones appear first inside the viewing order
        g.stories.sort((a, b) => {
          const aViewed = viewedStatusIds.has(a.id);
          const bViewed = viewedStatusIds.has(b.id);
          if (aViewed === bViewed) return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          return aViewed ? 1 : -1; // unread first
        });

        return {
          user: g.user,
          stories: g.stories,
          hasUnread
        };
      });

      // Sort groups so users with unread stories are listed first
      grouped.sort((a, b) => (a.hasUnread === b.hasUnread ? 0 : a.hasUnread ? -1 : 1));

      setGroupedStories(grouped);
    } catch (err) {
      console.error('Error fetching statuses:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatuses();

    // Subscribe to statuses INSERT/DELETE events to keep feed updated
    const statusChannel = supabase
      .channel('public:statuses')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'statuses' }, () => {
        fetchStatuses();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(statusChannel);
    };
  }, [currentUserId]);

  // 2. Insert new status
  const handlePostStatus = async () => {
    if (!textContent.trim()) return;
    setPosting(true);
    try {
      const { error } = await supabase
        .from('statuses')
        .insert({
          user_id: currentUserId,
          text_content: textContent,
          bg_color: activeBg,
          font_style: activeStyle,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // trigger handles this but we supply fallback
        });

      if (error) throw error;

      setTextContent('');
      setShowCreator(false);
      fetchStatuses();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setPosting(false);
    }
  };

  // 3. Mark a status as viewed
  const markStatusViewed = async (statusId: string) => {
    try {
      await supabase
        .from('status_views')
        .insert({
          status_id: statusId,
          viewer_id: currentUserId
        });

      // Increment view counter locally
      // (Supabase trigger could handle it, or we just rely on count views)
      // Actually our SQL view views list, so it works perfectly.
    } catch (err) {
      // ON CONFLICT DO NOTHING handles duplicate views silently
    }
  };

  // 4. Viewer progress timer hook
  useEffect(() => {
    if (viewerGroupIndex === null) {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      return;
    }

    const currentGroup = viewerGroupIndex === -1 
      ? { user: { display_name: 'My Statuses' }, stories: myStories }
      : groupedStories[viewerGroupIndex];

    const currentStory = currentGroup?.stories[viewerStoryIndex];

    if (!currentStory) {
      // Finished all stories in this group
      handleNextGroup();
      return;
    }

    // Mark as viewed
    markStatusViewed(currentStory.id);

    if (viewerPaused) {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      return;
    }

    setViewerProgress(0);

    const intervalTime = 50; // 50ms interval (5 seconds total = 100 steps)
    const stepIncrement = 1;

    progressIntervalRef.current = setInterval(() => {
      setViewerProgress((prev) => {
        if (prev >= 100) {
          clearInterval(progressIntervalRef.current!);
          // Advance to next story
          setViewerStoryIndex((idx) => idx + 1);
          return 0;
        }
        return prev + stepIncrement;
      });
    }, intervalTime);

    return () => {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, [viewerGroupIndex, viewerStoryIndex, viewerPaused]);

  // Navigate viewer groups
  const handleNextGroup = () => {
    if (viewerGroupIndex === null) return;

    if (viewerGroupIndex === -1) {
      // My stories finished -> move to first group of others
      if (groupedStories.length > 0) {
        setViewerGroupIndex(0);
        setViewerStoryIndex(0);
      } else {
        closeViewer();
      }
    } else {
      // Others group finished -> move to next group
      if (viewerGroupIndex + 1 < groupedStories.length) {
        setViewerGroupIndex(viewerGroupIndex + 1);
        setViewerStoryIndex(0);
      } else {
        closeViewer();
      }
    }
  };

  const handlePrevGroup = () => {
    if (viewerGroupIndex === null) return;

    if (viewerGroupIndex === -1) {
      // At my stories: close or restart
      setViewerStoryIndex(0);
    } else {
      // Move to previous group
      if (viewerGroupIndex === 0) {
        // Go back to my stories if available
        if (myStories.length > 0) {
          setViewerGroupIndex(-1);
          setViewerStoryIndex(myStories.length - 1);
        } else {
          setViewerStoryIndex(0);
        }
      } else {
        setViewerGroupIndex(viewerGroupIndex - 1);
        const prevGroup = groupedStories[viewerGroupIndex - 1];
        setViewerStoryIndex(prevGroup.stories.length - 1);
      }
    }
  };

  const handleViewerNav = (side: 'left' | 'right') => {
    const currentGroup = viewerGroupIndex === -1 
      ? { stories: myStories }
      : groupedStories[viewerGroupIndex!];

    if (side === 'right') {
      if (viewerStoryIndex + 1 < currentGroup.stories.length) {
        setViewerStoryIndex(prev => prev + 1);
      } else {
        handleNextGroup();
      }
    } else {
      if (viewerStoryIndex > 0) {
        setViewerStoryIndex(prev => prev - 1);
      } else {
        handlePrevGroup();
      }
    }
  };

  const closeViewer = () => {
    setViewerGroupIndex(null);
    setViewerStoryIndex(0);
    setViewerProgress(0);
    setViewerPaused(false);
    fetchStatuses(); // reload read badges
  };

  // 5. Load seen-by users
  const fetchSeenBy = async (statusId: string) => {
    setLoadingSeenBy(true);
    setSeenUsersList([]);
    try {
      const { data, error } = await supabase
        .from('status_views')
        .select('viewed_at, viewer_id')
        .eq('status_id', statusId);

      if (error) throw error;

      const userProfiles = await Promise.all(
        (data || []).map(async (v) => {
          const { data: user } = await supabase
            .from('users')
            .select('display_name, username, avatar_url')
            .eq('id', v.viewer_id)
            .single();
          
          return {
            ...v,
            user
          };
        })
      );

      setSeenUsersList(userProfiles);
    } catch (err) {
      console.error('Error fetching seen status views:', err);
    } finally {
      setLoadingSeenBy(false);
    }
  };

  useEffect(() => {
    if (showSeenBy) {
      fetchSeenBy(showSeenBy);
    }
  }, [showSeenBy]);

  const activeGroup = viewerGroupIndex === null ? null : (
    viewerGroupIndex === -1 
      ? { user: { display_name: 'My Statuses', avatar_url: null }, stories: myStories }
      : groupedStories[viewerGroupIndex]
  );
  const activeStory = activeGroup ? activeGroup.stories[viewerStoryIndex] : null;

  return (
    <div className="tab-container">
      <div className="tab-header">
        <h2 className="tab-title">Status</h2>
      </div>

      <div className="tab-body">
        {/* Horizontal stories feed */}
        <div className="status-feed-container">
          {/* Creator Ring */}
          <div className="status-avatar-wrapper" onClick={() => {
            if (myStories.length > 0) {
              setViewerGroupIndex(-1);
              setViewerStoryIndex(0);
            } else {
              setShowCreator(true);
            }
          }}>
            <div className="status-ring creator">
              {myStories.length > 0 ? (
                <Avatar src={myStories[0].user?.avatar_url} name="Me" />
              ) : (
                <div 
                  className="user-avatar" 
                  style={{ backgroundColor: 'var(--bg-input)', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center' }}
                >
                  <Plus size={20} style={{ color: 'var(--text-secondary)' }} />
                </div>
              )}
            </div>
            <span className="status-name" style={{ fontWeight: 600 }}>
              {myStories.length > 0 ? 'My Stories' : 'Add Status'}
            </span>
          </div>

          {/* Others stories */}
          {loading ? (
            <div style={{ alignSelf: 'center', marginLeft: '10px' }}>
              <Loader2 className="spinner" size={18} />
            </div>
          ) : (
            groupedStories.map((group, idx) => (
              <div 
                key={group.user.id} 
                className="status-avatar-wrapper"
                onClick={() => {
                  setViewerGroupIndex(idx);
                  setViewerStoryIndex(0);
                }}
              >
                <div className={`status-ring ${group.hasUnread ? '' : 'seen'}`}>
                  <Avatar src={group.user.avatar_url} name={group.user.display_name} />
                </div>
                <span className="status-name">{group.user.display_name}</span>
              </div>
            ))
          )}
        </div>

        {/* Status Creator Section when prompt is active */}
        {showCreator && (
          <div className="modal-overlay" onClick={() => setShowCreator(false)}>
            <div className="modal-card" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">Create Status</div>
                <button className="input-action-btn" onClick={() => setShowCreator(false)}>
                  <X size={18} />
                </button>
              </div>

              <div className="modal-body text-center">
                {/* Live Preview Card */}
                <div 
                  className="status-preview-box" 
                  style={{ 
                    background: activeBg, 
                    fontWeight: activeStyle === 'bold' ? '700' : 'normal',
                    fontStyle: activeStyle === 'italic' ? 'italic' : 'normal',
                    fontSize: '24px'
                  }}
                >
                  <textarea
                    className="status-preview-text"
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    placeholder="What's on your mind?"
                    maxLength={200}
                    style={{ 
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: '#ffffff',
                      resize: 'none',
                      textAlign: 'center',
                      fontFamily: 'inherit',
                      fontWeight: 'inherit',
                      fontStyle: 'inherit'
                    }}
                  />
                  <div style={{ position: 'absolute', bottom: '15px', right: '20px', fontSize: '11px', opacity: 0.6 }}>
                    {200 - textContent.length} chars
                  </div>
                </div>

                <div className="status-controls">
                  {/* Style Toggles */}
                  <div className="flex justify-between align-center" style={{ padding: '0 10px' }}>
                    <span className="form-label">Typography Style</span>
                    <div className="flex gap-2">
                      <button 
                        className={`btn btn-secondary ${activeStyle === 'normal' ? 'btn-primary' : ''}`}
                        onClick={() => setActiveStyle('normal')}
                        style={{ padding: '4px 8px', fontSize: '11px' }}
                      >
                        Normal
                      </button>
                      <button 
                        className={`btn btn-secondary ${activeStyle === 'bold' ? 'btn-primary' : ''}`}
                        onClick={() => setActiveStyle('bold')}
                        style={{ padding: '4px 8px', fontSize: '11px', fontWeight: 700 }}
                      >
                        Bold
                      </button>
                      <button 
                        className={`btn btn-secondary ${activeStyle === 'italic' ? 'btn-primary' : ''}`}
                        onClick={() => setActiveStyle('italic')}
                        style={{ padding: '4px 8px', fontSize: '11px', fontStyle: 'italic' }}
                      >
                        Italic
                      </button>
                    </div>
                  </div>

                  {/* Swatches palette */}
                  <div>
                    <div className="form-label" style={{ marginBottom: '8px', textAlign: 'left', paddingLeft: '10px' }}>Background Color</div>
                    <div className="color-swatches">
                      {COLOR_PALETTE.map(color => (
                        <div 
                          key={color}
                          className={`swatch ${activeBg === color ? 'active' : ''}`}
                          style={{ backgroundColor: color }}
                          onClick={() => setActiveBg(color)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowCreator(false)}>Cancel</button>
                <button 
                  className="btn btn-primary" 
                  disabled={!textContent.trim() || posting}
                  onClick={handlePostStatus}
                >
                  {posting ? <Loader2 className="spinner" size={16} /> : <><Send size={16} /> Post Status</>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Status stories list editor table if they have own stories */}
      {myStories.length > 0 && !showCreator && (
        <div className="settings-section" style={{ maxWidth: '650px', margin: '0 auto' }}>
          <div className="settings-section-title">My Posted Stories</div>
          <div className="flex flex-column gap-2">
            {myStories.map(story => (
              <div 
                key={story.id}
                className="conversation-row"
                style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)' }}
              >
                <div 
                  style={{ 
                    width: '38px', 
                    height: '38px', 
                    borderRadius: '50%', 
                    background: story.bg_color, 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    color: '#ffffff',
                    fontSize: '8px',
                    fontWeight: 700,
                    overflow: 'hidden',
                    flexShrink: 0
                  }}
                >
                  Aa
                </div>
                <div className="convo-details">
                  <div className="convo-name" style={{ fontSize: '13.5px' }}>{story.text_content}</div>
                  <div className="convo-preview" style={{ fontSize: '11px' }}>Expires in {Math.round((new Date(story.expires_at).getTime() - Date.now()) / (60 * 60 * 1000))} hours</div>
                </div>
                <button 
                  className="btn btn-secondary" 
                  style={{ padding: '6px 12px', fontSize: '11px', display: 'flex', gap: '4px' }}
                  onClick={() => setShowSeenBy(story.id)}
                >
                  <Eye size={12} /> Viewers
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status Viewer Carousel Modal Overlay */}
      {activeStory && (
        <div 
          className="status-viewer-overlay"
          onMouseDown={() => setViewerPaused(true)}
          onMouseUp={() => setViewerPaused(false)}
          onTouchStart={(e) => {
            touchStartRef.current = e.touches[0].clientX;
            setViewerPaused(true);
          }}
          onTouchEnd={(e) => {
            setViewerPaused(false);
            const diff = e.changedTouches[0].clientX - touchStartRef.current;
            if (Math.abs(diff) > 50) {
              handleViewerNav(diff > 0 ? 'left' : 'right');
            }
          }}
        >
          <div className="status-viewer-content">
            {/* Top Progress Indicators */}
            <div className="status-progress-container">
              {activeGroup!.stories.map((s, idx) => (
                <div key={s.id} className="status-progress-track">
                  <div 
                    className="status-progress-bar" 
                    style={{ 
                      width: idx < viewerStoryIndex 
                        ? '100%' 
                        : idx === viewerStoryIndex 
                          ? `${viewerProgress}%` 
                          : '0%' 
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Header info */}
            <div className="status-viewer-header">
              <Avatar src={activeStory.user?.avatar_url} name={activeStory.user?.display_name || 'User'} />
              <div className="chat-header-info">
                <span className="convo-name" style={{ color: '#ffffff' }}>{activeStory.user?.display_name}</span>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>
                  {new Date(activeStory.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  onClick={() => setViewerPaused(prev => !prev)}
                  style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer' }}
                >
                  {viewerPaused ? <Play size={20} /> : <Pause size={20} />}
                </button>
                <button 
                  onClick={closeViewer}
                  style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer' }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Viewer Navigation Tap Zones */}
            <div className="status-viewer-nav prev" onClick={() => handleViewerNav('left')} />
            <div className="status-viewer-nav next" onClick={() => handleViewerNav('right')} />

            {/* Main Story Content Card */}
            <div 
              className="status-viewer-body"
              style={{ 
                background: activeStory.bg_color,
                fontWeight: activeStory.font_style === 'bold' ? '700' : 'normal',
                fontStyle: activeStory.font_style === 'italic' ? 'italic' : 'normal'
              }}
            >
              <div style={{ fontSize: '26px', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                {activeStory.text_content}
              </div>
            </div>

            {/* Footer containing views if owned */}
            {activeStory.user_id === currentUserId && (
              <div className="status-viewer-footer">
                <div 
                  className="status-views-panel"
                  onClick={() => {
                    setViewerPaused(true);
                    setShowSeenBy(activeStory.id);
                  }}
                >
                  <Eye size={16} />
                  <span>Viewed by {activeStory.view_count || seenUsersList.length || 0}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Seen By Modal Overlay */}
      {showSeenBy && (
        <div className="modal-overlay" onClick={() => {
          setShowSeenBy(null);
          setViewerPaused(false);
        }}>
          <div className="modal-card" style={{ maxWidth: '380px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Eye size={18} /> Viewed By</div>
              <button className="input-action-btn" onClick={() => {
                setShowSeenBy(null);
                setViewerPaused(false);
              }}>
                <X size={18} />
              </button>
            </div>

            <div className="modal-body" style={{ maxHeight: '280px', overflowY: 'auto' }}>
              {loadingSeenBy ? (
                <div className="text-center"><Loader2 className="spinner" size={20} /></div>
              ) : seenUsersList.length === 0 ? (
                <p className="text-center" style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No views yet. This story expires in 24 hours.</p>
              ) : (
                <div className="flex flex-column gap-2" style={{ gap: '10px' }}>
                  {seenUsersList.map(item => (
                    <div 
                      key={item.viewer_id} 
                      className="flex align-center gap-2"
                      style={{ padding: '6px 0', borderBottom: '1px solid var(--border-color)' }}
                    >
                      <Avatar src={item.user?.avatar_url} name={item.user?.display_name || 'User'} size={32} />
                      <div className="user-info">
                        <span className="user-name" style={{ fontSize: '13px' }}>{item.user?.display_name}</span>
                        <span className="user-handle" style={{ fontSize: '11px' }}>@{item.user?.username}</span>
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                        {new Date(item.viewed_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
