import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { 
  Users, Loader2, Play, Ban, ShieldAlert,
  Smile, Send
} from 'lucide-react';

interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_online: boolean;
}

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content_type: 'text' | 'emoji' | 'system';
  content: string | null;
  is_read: boolean;
  created_at: string;
}

interface Conversation {
  id: string;
  participant_a: string;
  participant_b: string;
  is_random_chat: boolean;
  partner: UserProfile;
}

interface RandomChatTabProps {
  currentUserId: string;
}

export const RandomChatTab: React.FC<RandomChatTabProps> = ({ currentUserId }) => {
  const [matchState, setMatchState] = useState<'idle' | 'searching' | 'matched' | 'timeout'>('idle');
  const [countdown, setCountdown] = useState(30);
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null);
  
  // Chat Room States
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const pollIntervalRef = useRef<any>(null);
  const countdownIntervalRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const presenceChannelRef = useRef<any>(null);

  const EMOJIS = ['❤️', '😂', '🔥', '👍', '🙏', '🎉', '😮', '😢', '😍', '✨', '🙌', '💯'];

  // 1. Start Matchmaker Search
  const startMatching = async () => {
    setMatchState('searching');
    setCountdown(30);
    setActiveConvo(null);
    setMessages([]);

    try {
      // First immediate poll
      const matchedConvo = await pollMatchmaker();
      if (matchedConvo) return;

      // Start countdown
      countdownIntervalRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            cancelMatching('timeout');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      // Poll database every 2 seconds
      pollIntervalRef.current = setInterval(async () => {
        await pollMatchmaker();
      }, 2000);

    } catch (err) {
      console.error('Matchmaker setup error:', err);
      setMatchState('idle');
    }
  };

  const pollMatchmaker = async (): Promise<boolean> => {
    try {
      const { data, error } = await supabase.rpc('join_matchmaking', { 
        caller_id: currentUserId 
      });

      if (error) throw error;
      
      const res = data as any;
      if (res && res.matched) {
        // Clear timers
        clearTimers();

        // Fetch partner user profile
        const { data: partner } = await supabase
          .from('users')
          .select('id, username, display_name, avatar_url, is_online')
          .eq('id', res.partner_id)
          .single();

        const convo: Conversation = {
          id: res.conversation_id,
          participant_a: currentUserId < res.partner_id ? currentUserId : res.partner_id,
          participant_b: currentUserId < res.partner_id ? res.partner_id : currentUserId,
          is_random_chat: true,
          partner: partner || {
            id: res.partner_id,
            username: 'random_partner',
            display_name: 'Random Chatter',
            avatar_url: null,
            is_online: true
          }
        };

        setActiveConvo(convo);
        setMatchState('matched');
        return true;
      }
      return false;
    } catch (err) {
      console.error('Error polling matchmaking queue:', err);
      return false;
    }
  };

  const cancelMatching = async (finalState: 'idle' | 'timeout' = 'idle') => {
    clearTimers();
    setMatchState(finalState);
    
    // Remove from queue
    try {
      await supabase
        .from('matchmaking_queue')
        .delete()
        .eq('user_id', currentUserId);
    } catch (e) {
      // ignore
    }
  };

  const clearTimers = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
  };

  useEffect(() => {
    return () => clearTimers();
  }, []);

  // 2. Chat room setup when matched
  const fetchMessages = async (convoId: string) => {
    setMessagesLoading(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', convoId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setMessages((data || []).reverse());
    } catch (err) {
      console.error('Error loading random chat messages:', err);
    } finally {
      setMessagesLoading(false);
    }
  };

  const markAsRead = async (convoId: string) => {
    try {
      await supabase.rpc('mark_messages_read', { conv_id: convoId });
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    if (!activeConvo) return;

    fetchMessages(activeConvo.id);
    markAsRead(activeConvo.id);

    // Subscribe to messages in this room
    const chatChannel = supabase
      .channel(`random_room_${activeConvo.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${activeConvo.id}` },
        (payload) => {
          const newMsg = payload.new as Message;
          if (newMsg.sender_id !== currentUserId) {
            markAsRead(activeConvo.id);
          }
          setMessages(prev => [...prev, newMsg]);
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
      )
      .subscribe();

    // Subscribe to Presence for typing status
    const presenceChannel = supabase.channel(`random_presence_${activeConvo.id}`, {
      config: { presence: { key: currentUserId } }
    });

    presenceChannelRef.current = presenceChannel;

    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        const partnerId = activeConvo.partner.id;
        
        let isPartnerTyping = false;
        if (state[partnerId]) {
          const userPresences = state[partnerId] as any[];
          isPartnerTyping = userPresences.some(p => p.is_typing);
        }
        setPartnerTyping(isPartnerTyping);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({ is_typing: false });
        }
      });

    return () => {
      supabase.removeChannel(chatChannel);
      if (presenceChannelRef.current) {
        supabase.removeChannel(presenceChannelRef.current);
      }
    };
  }, [activeConvo]);

  // 3. Send Message
  const handleSendMessage = async () => {
    if (!activeConvo || !inputText.trim()) return;

    try {
      const text = inputText.trim();
      const payload: Partial<Message> = {
        conversation_id: activeConvo.id,
        sender_id: currentUserId,
        content_type: text.length <= 4 && /^\p{Emoji}+$/u.test(text) ? 'emoji' : 'text',
        content: text,
        is_read: false
      };

      const { error } = await supabase
        .from('messages')
        .insert(payload);

      if (error) throw error;
      
      setInputText('');
      if (presenceChannelRef.current) {
        presenceChannelRef.current.track({ is_typing: false });
      }
    } catch (err: any) {
      console.error('Error sending message:', err.message);
    }
  };

  // 4. End Chat Session
  const handleEndChat = async () => {
    if (!activeConvo) return;
    const confirm = window.confirm('Are you sure you want to end this random chat? This room will be closed.');
    if (!confirm) return;

    try {
      // Insert system exit message
      await supabase.from('messages').insert({
        conversation_id: activeConvo.id,
        sender_id: currentUserId,
        content_type: 'system',
        content: 'Random chat ended. The partner left the session.'
      });

      // Clear convo
      setActiveConvo(null);
      setMatchState('idle');
    } catch (e) {
      console.error(e);
    }
  };

  // 5. Block partner
  const handleBlockPartner = async () => {
    if (!activeConvo) return;
    const confirm = window.confirm(`Block this user? You will not be paired with them again.`);
    if (!confirm) return;

    try {
      const { error } = await supabase.from('blocks').insert({
        blocker_id: currentUserId,
        blocked_id: activeConvo.partner.id,
        reason: 'Blocked during Random Chat session'
      });

      if (error) throw error;

      alert('User blocked. Session ended.');
      
      // End conversation system message
      await supabase.from('messages').insert({
        conversation_id: activeConvo.id,
        sender_id: currentUserId,
        content_type: 'system',
        content: 'Random chat session closed.'
      });

      setActiveConvo(null);
      setMatchState('idle');
    } catch (err: any) {
      alert(`Error blocking: ${err.message}`);
    }
  };

  return (
    <div className="tab-container">
      <div className="tab-header">
        <h2 className="tab-title">Random Chat</h2>
      </div>

      <div className="tab-body" style={{ padding: 0, display: 'flex', flexDirection: 'column', height: 'calc(100% - 70px)' }}>
        
        {/* IDLE VIEW */}
        {matchState === 'idle' && (
          <div className="matchmaker-container grow">
            <div className="radar-center" style={{ width: '80px', height: '80px' }}>
              <Users size={32} />
            </div>
            
            <div className="match-info-text">
              <span className="match-title">Connect Anonymously</span>
              <p className="match-desc">
                Find a random partner and chat in a private text-only session.
                All random chat rooms expire automatically after 24 hours.
              </p>
            </div>

            <button className="btn btn-primary" onClick={startMatching}>
              <Play size={16} /> Find Someone
            </button>
          </div>
        )}

        {/* SEARCHING RADAR VIEW */}
        {matchState === 'searching' && (
          <div className="matchmaker-container grow">
            <div className="match-radar">
              <div className="radar-circle" />
              <div className="radar-circle" />
              <div className="radar-circle" />
              <div className="radar-center">
                <Users size={20} />
              </div>
            </div>

            <div className="match-info-text">
              <span className="match-title">Finding Partner...</span>
              <p className="match-desc">Looking for online chatters. Time remaining: {countdown}s</p>
            </div>

            <button className="btn btn-danger" onClick={() => cancelMatching()}>
              Cancel Search
            </button>
          </div>
        )}

        {/* TIMEOUT VIEW */}
        {matchState === 'timeout' && (
          <div className="matchmaker-container grow">
            <div className="radar-center" style={{ width: '80px', height: '80px', backgroundColor: 'var(--danger)', boxShadow: '0 0 15px var(--danger)' }}>
              <ShieldAlert size={32} />
            </div>
            
            <div className="match-info-text">
              <span className="match-title" style={{ color: 'var(--danger)' }}>Search Timeout</span>
              <p className="match-desc">
                No matches found right now. People might be busy. Try again soon!
              </p>
            </div>

            <div className="flex gap-2">
              <button className="btn btn-secondary" onClick={() => setMatchState('idle')}>Back</button>
              <button className="btn btn-primary" onClick={startMatching}>Try Again</button>
            </div>
          </div>
        )}

        {/* MATCHED CHAT ROOM VIEW */}
        {matchState === 'matched' && activeConvo && (
          <div className="chat-window grow flex flex-column">
            
            {/* Header */}
            <div className="chat-window-header">
              <div className="user-avatar-container" style={{ width: '40px', height: '40px' }}>
                <div 
                  className="user-avatar" 
                  style={{ 
                    background: 'linear-gradient(135deg, #aa3bff, #3f8cff)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    color: '#ffffff',
                    fontWeight: 700
                  }}
                >
                  ?
                </div>
              </div>
              
              <div className="chat-header-info">
                <span className="convo-name" style={{ fontSize: '15px' }}>Anonymous Chat</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {partnerTyping ? <span className="typing-text">typing...</span> : 'Connected'}
                </span>
              </div>

              <div className="chat-header-actions">
                <button 
                  className="btn btn-danger" 
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                  onClick={handleEndChat}
                >
                  End Chat
                </button>
                <button 
                  className="btn btn-outline" 
                  style={{ padding: '6px 8px' }}
                  title="Block User"
                  onClick={handleBlockPartner}
                >
                  <Ban size={16} style={{ color: 'var(--danger)' }} />
                </button>
              </div>
            </div>

            {/* Messages body */}
            <div className="chat-messages-area grow">
              <div className="messages-list-wrapper">
                {messagesLoading ? (
                  <div className="text-center"><Loader2 className="spinner" size={20} /></div>
                ) : (
                  messages.map((msg) => {
                    const isOwn = msg.sender_id === currentUserId;
                    const isSystem = msg.content_type === 'system';

                    if (isSystem) {
                      return (
                        <div key={msg.id} className="message-row system">
                          <div className="message-bubble">{msg.content}</div>
                        </div>
                      );
                    }

                    return (
                      <div key={msg.id} className={`message-row ${isOwn ? 'sender' : 'receiver'}`}>
                        <div className="message-bubble">
                          <span style={{ fontSize: msg.content_type === 'emoji' ? '28px' : 'inherit' }}>
                            {msg.content}
                          </span>
                          <span className="message-meta">
                            {new Date(msg.created_at).toLocaleTimeString(undefined, { 
                              hour: '2-digit', 
                              minute: '2-digit',
                              hour12: false
                            })}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Typing Indicator */}
            {partnerTyping && (
              <div className="typing-dots">
                <div className="typing-dot" />
                <div className="typing-dot" />
                <div className="typing-dot" />
              </div>
            )}

            {/* Input Bar */}
            <div className="chat-input-bar">
              {/* Emoji overlay */}
              <div style={{ position: 'relative' }}>
                <button className="input-action-btn" onClick={() => setShowEmojiPicker(!showEmojiPicker)}>
                  <Smile size={20} />
                </button>
                {showEmojiPicker && (
                  <div 
                    style={{ 
                      position: 'absolute',
                      bottom: '50px',
                      left: '0',
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border-color)',
                      boxShadow: 'var(--shadow-md)',
                      borderRadius: 'var(--radius-md)',
                      padding: '8px',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: '6px',
                      zIndex: 200
                    }}
                  >
                    {EMOJIS.map(emoji => (
                      <button
                        key={emoji}
                        onClick={() => {
                          setInputText(prev => prev + emoji);
                          setShowEmojiPicker(false);
                        }}
                        style={{ fontSize: '20px', border: 'none', background: 'transparent', cursor: 'pointer', padding: '6px' }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Text Input */}
              <textarea
                className="chat-input-field"
                placeholder="Send a text-only message..."
                rows={1}
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  if (presenceChannelRef.current) {
                    presenceChannelRef.current.track({ is_typing: e.target.value.length > 0 });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                maxLength={2000}
              />

              <button 
                className="btn btn-primary"
                style={{ borderRadius: '50%', width: '38px', height: '38px', padding: 0 }}
                onClick={handleSendMessage}
                disabled={!inputText.trim()}
              >
                <Send size={16} />
              </button>
            </div>

          </div>
        )}

      </div>
    </div>
  );
};
