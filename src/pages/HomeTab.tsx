import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { Avatar } from '../components/Avatar';
import { Lightbox } from '../components/Lightbox';
import { 
  Send, Paperclip, MessageSquare, CornerDownRight, 
  Trash2, Smile, ArrowLeft, Loader2, X
} from 'lucide-react';

interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_online: boolean;
  bio: string | null;
}

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content_type: 'text' | 'image' | 'emoji' | 'system';
  content: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  is_read: boolean;
  read_at: string | null;
  reply_to_id: string | null;
  deleted_at: string | null;
  created_at: string;
  reply_message?: {
    content: string | null;
    sender_name: string;
  } | null;
}

interface Conversation {
  id: string;
  participant_a: string;
  participant_b: string;
  last_message_id: string | null;
  last_activity_at: string;
  is_random_chat: boolean;
  created_at: string;
  partner: UserProfile;
  last_message?: Message | null;
  unread_count: number;
}

interface HomeTabProps {
  currentUserId: string;
  initialConversationId?: string | null;
  onClearInitialConversation?: () => void;
}

export const HomeTab: React.FC<HomeTabProps> = ({ 
  currentUserId,
  initialConversationId,
  onClearInitialConversation
}) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null);
  
  // Chat Room States
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [replyMessage, setReplyMessage] = useState<Message | null>(null);
  
  // Emoji overlay
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  
  // Typing Indicator (Presence)
  const [isTyping, setIsTyping] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  
  // Media Signed URLs Cache
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  
  // Lightbox State
  const [activeImage, setActiveImage] = useState<string | null>(null);
  
  // Hovered message context menu
  const [contextMenuMsgId, setContextMenuMsgId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const presenceChannelRef = useRef<any>(null);
  const typingTimerRef = useRef<any>(null);

  // Predefined Emojis
  const EMOJIS = ['❤️', '😂', '🔥', '👍', '🙏', '🎉', '😮', '😢', '😍', '✨', '🙌', '💯'];

  // 1. Fetch Conversations List
  const fetchConversations = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Fetch conversations
      const { data: convs, error } = await supabase
        .from('conversations')
        .select('*')
        .or(`participant_a.eq.${currentUserId},participant_b.eq.${currentUserId}`)
        .order('last_activity_at', { ascending: false });

      if (error) throw error;

      const updatedConvs = await Promise.all(
        (convs || []).map(async (convo: any) => {
          const partnerId = convo.participant_a === currentUserId ? convo.participant_b : convo.participant_a;
          
          // Get partner profile
          const { data: partner } = await supabase
            .from('users')
            .select('*')
            .eq('id', partnerId)
            .single();

          // Get last message details
          let lastMessage: Message | null = null;
          if (convo.last_message_id) {
            const { data: msg } = await supabase
              .from('messages')
              .select('*')
              .eq('id', convo.last_message_id)
              .single();
            lastMessage = msg;
          }

          // Get unread count
          const { count } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('conversation_id', convo.id)
            .eq('is_read', false)
            .neq('sender_id', currentUserId);

          return {
            ...convo,
            partner: partner || {
              id: partnerId,
              username: 'unknown_user',
              display_name: 'Unknown User',
              avatar_url: null,
              is_online: false,
              bio: null
            },
            last_message: lastMessage,
            unread_count: count || 0
          } as Conversation;
        })
      );

      // Sort again by last_activity_at to bubble active ones to the top
      updatedConvs.sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime());
      
      setConversations(updatedConvs);
    } catch (err) {
      console.error('Error fetching conversations:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();

    // Subscribe to conversations table changes
    const conversationsSubscription = supabase
      .channel('public:conversations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        fetchConversations(true);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(conversationsSubscription);
    };
  }, [currentUserId]);

  useEffect(() => {
    if (initialConversationId && conversations.length > 0) {
      const found = conversations.find(c => c.id === initialConversationId);
      if (found) {
        setActiveConvo(found);
        if (onClearInitialConversation) {
          onClearInitialConversation();
        }
      }
    }
  }, [initialConversationId, conversations]);

  // 2. Fetch Messages for Active Conversation
  const fetchMessages = async (convoId: string) => {
    setMessagesLoading(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', convoId)
        .order('created_at', { ascending: false }) // newest first for inverted scroll
        .limit(60);

      if (error) throw error;

      // Enhance messages with reply details if present
      const enhancedMessages = await Promise.all(
        (data || []).map(async (msg) => {
          let replyData = null;
          if (msg.reply_to_id) {
            const { data: parentMsg } = await supabase
              .from('messages')
              .select('content, sender_id')
              .eq('id', msg.reply_to_id)
              .single();
            
            if (parentMsg) {
              const { data: senderProfile } = await supabase
                .from('users')
                .select('display_name')
                .eq('id', parentMsg.sender_id)
                .single();
              
              replyData = {
                content: parentMsg.content,
                sender_name: senderProfile?.display_name || 'User'
              };
            }
          }
          return {
            ...msg,
            reply_message: replyData
          };
        })
      );

      setMessages(enhancedMessages.reverse());

      // Fetch signed URLs for any image messages
      enhancedMessages.forEach((msg) => {
        if (msg.content_type === 'image' && msg.media_url) {
          loadSignedUrl(msg.media_url);
        }
      });
    } catch (err) {
      console.error('Error fetching messages:', err);
    } finally {
      setMessagesLoading(false);
    }
  };

  // Helper to load and cache storage signed URL for image attachment
  const loadSignedUrl = async (path: string) => {
    if (signedUrls[path]) return;
    try {
      const { data, error } = await supabase.storage
        .from('chat-attachments')
        .createSignedUrl(path, 3600); // 1 hour expiry

      if (error) throw error;
      if (data?.signedUrl) {
        setSignedUrls(prev => ({ ...prev, [path]: data.signedUrl }));
      }
    } catch (err) {
      console.error('Error signing storage URL:', err);
    }
  };

  // 3. Mark active conversation's messages as read
  const markAsRead = async (convoId: string) => {
    try {
      await supabase.rpc('mark_messages_read', { conv_id: convoId });
      // Update conversations count locally
      setConversations(prev => 
        prev.map(c => c.id === convoId ? { ...c, unread_count: 0 } : c)
      );
    } catch (err) {
      console.error('Error marking messages read:', err);
    }
  };

  useEffect(() => {
    if (!activeConvo) return;

    fetchMessages(activeConvo.id);
    markAsRead(activeConvo.id);

    // Subscribe to real-time messages for this conversation
    const messagesChannel = supabase
      .channel(`room_${activeConvo.id}`)
      .on(
        'postgres_changes', 
        { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${activeConvo.id}` }, 
        async (payload) => {
          if (payload.eventType === 'INSERT') {
            const newMsg = payload.new as Message;
            
            // Mark read if tab is active
            if (newMsg.sender_id !== currentUserId) {
              markAsRead(activeConvo.id);
            }

            // Get reply details if any
            let replyData = null;
            if (newMsg.reply_to_id) {
              const { data: parentMsg } = await supabase
                .from('messages')
                .select('content, sender_id')
                .eq('id', newMsg.reply_to_id)
                .single();
              
              if (parentMsg) {
                const { data: senderProfile } = await supabase
                  .from('users')
                  .select('display_name')
                  .eq('id', parentMsg.sender_id)
                  .single();
                
                replyData = {
                  content: parentMsg.content,
                  sender_name: senderProfile?.display_name || 'User'
                };
              }
            }

            const enhancedMsg = {
              ...newMsg,
              reply_message: replyData
            };

            if (newMsg.content_type === 'image' && newMsg.media_url) {
              await loadSignedUrl(newMsg.media_url);
            }

            setMessages(prev => [...prev, enhancedMsg]);
            
            // Auto scroll to bottom (represented by top of inverted list)
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          } else if (payload.eventType === 'UPDATE') {
            const updatedMsg = payload.new as Message;
            setMessages(prev => 
              prev.map(m => m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m)
            );
          }
        }
      )
      .subscribe();

    // Set up Presence channel for typing indicator
    const presenceChannel = supabase.channel(`presence_${activeConvo.id}`, {
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
      supabase.removeChannel(messagesChannel);
      if (presenceChannelRef.current) {
        supabase.removeChannel(presenceChannelRef.current);
      }
    };
  }, [activeConvo?.id]);

  // 4. Send Message
  const handleSendMessage = async (textOverride?: string, mediaInfo?: { path: string, mime: string }) => {
    if (!activeConvo) return;
    
    const textToSend = textOverride !== undefined ? textOverride : inputText.trim();
    const isImage = !!mediaInfo;
    
    if (!textToSend && !isImage) return;

    try {
      const payload: Partial<Message> = {
        conversation_id: activeConvo.id,
        sender_id: currentUserId,
        content_type: isImage ? 'image' : (textToSend.length <= 4 && /^\p{Emoji}+$/u.test(textToSend) ? 'emoji' : 'text'),
        content: isImage ? null : textToSend,
        media_url: isImage ? mediaInfo.path : null,
        media_mime_type: isImage ? mediaInfo.mime : null,
        reply_to_id: replyMessage?.id || null,
        is_read: false,
      };

      const { error } = await supabase
        .from('messages')
        .insert(payload);

      if (error) throw error;

      // Reset Input States
      if (!isImage) setInputText('');
      setReplyMessage(null);
      handleTyping(false);
    } catch (err: any) {
      console.error('Error sending message:', err.message);
    }
  };

  // 5. Typing Indicator updates
  const handleTyping = (typing: boolean) => {
    setIsTyping(typing);
    if (presenceChannelRef.current) {
      presenceChannelRef.current.track({ is_typing: typing });
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    
    if (!isTyping) {
      handleTyping(true);
    }

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    
    typingTimerRef.current = setTimeout(() => {
      handleTyping(false);
    }, 2000);
  };

  // 6. Soft Delete own message
  const handleDeleteMessage = async (msgId: string) => {
    try {
      const { error } = await supabase
        .from('messages')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', msgId)
        .eq('sender_id', currentUserId);

      if (error) throw error;
      setContextMenuMsgId(null);
    } catch (err: any) {
      console.error('Error deleting message:', err.message);
    }
  };

  // 7. Image Upload Handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConvo) return;

    // Enforce chat size limit (5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('File size exceeds the 5MB limit.');
      return;
    }

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `attach_${Date.now()}.${fileExt}`;
      const filePath = `${activeConvo.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('chat-attachments')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Send the image message
      await handleSendMessage('', { path: filePath, mime: file.type });
    } catch (err: any) {
      console.error('Upload error:', err.message);
      alert('Failed to upload image.');
    } finally {
      setUploading(false);
    }
  };

  // Elapsed time formatter
  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60 * 1000) return 'Just now';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="chat-split-layout">
      {/* Left Conversations List Pane */}
      <div className={`chat-list-panel ${activeConvo ? 'mobile-hidden' : ''}`}>
        <div className="tab-header">
          <div className="brand-title">Chats</div>
        </div>

        <div className="conversations-scroll">
          {loading ? (
            <div className="text-center mt-4">
              <Loader2 className="spinner" size={24} style={{ margin: 'auto' }} />
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-center mt-4" style={{ padding: '20px', color: 'var(--text-muted)' }}>
              <MessageSquare size={36} style={{ margin: '0 auto 10px', opacity: 0.5 }} />
              <p>No active chats. Use the Search tab to find users and start messaging!</p>
            </div>
          ) : (
            conversations.map((convo) => (
              <div 
                key={convo.id} 
                className={`conversation-row ${activeConvo?.id === convo.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveConvo(convo);
                }}
              >
                <Avatar 
                  src={convo.partner.avatar_url} 
                  name={convo.partner.display_name} 
                  showStatus={true} 
                  isOnline={convo.partner.is_online}
                />
                
                <div className="convo-details">
                  <div className="convo-meta">
                    <span className="convo-name">{convo.partner.display_name}</span>
                    <span className="convo-time">{formatTime(convo.last_activity_at)}</span>
                  </div>
                  
                  <div className="convo-message-row">
                    <span className="convo-preview">
                      {convo.last_message?.deleted_at ? (
                        <span className="deleted-message">This message was deleted.</span>
                      ) : convo.last_message?.content_type === 'image' ? (
                        '📷 Attachment'
                      ) : (
                        convo.last_message?.content || 'No messages yet'
                      )}
                    </span>
                    
                    {convo.unread_count > 0 && (
                      <span className="convo-badge">{convo.unread_count}</span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Chat Window Panel */}
      <div className={`chat-window ${!activeConvo ? 'mobile-hidden' : ''}`}>
        {activeConvo ? (
          <>
            {/* Header */}
            <div className="chat-window-header">
              <button className="back-button" onClick={() => setActiveConvo(null)}>
                <ArrowLeft size={20} />
              </button>
              
              <Avatar 
                src={activeConvo.partner.avatar_url} 
                name={activeConvo.partner.display_name} 
                showStatus={true}
                isOnline={activeConvo.partner.is_online}
              />
              
              <div className="chat-header-info">
                <span className="convo-name" style={{ fontSize: '15px' }}>{activeConvo.partner.display_name}</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {partnerTyping ? (
                    <span className="typing-text">typing...</span>
                  ) : activeConvo.partner.is_online ? (
                    'Active now'
                  ) : (
                    'Offline'
                  )}
                </span>
              </div>

              {activeConvo.is_random_chat && (
                <div className="info-banner" style={{ margin: 0, padding: '4px 8px', borderRadius: 'var(--radius-sm)' }}>
                  Random Chat
                </div>
              )}
            </div>

            {/* Messages Area */}
            <div className="chat-messages-area">
              <div className="messages-list-wrapper">
                {messagesLoading ? (
                  <div className="text-center">
                    <Loader2 className="spinner" size={24} style={{ margin: 'auto' }} />
                  </div>
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
                      <div 
                        key={msg.id} 
                        className={`message-row ${isOwn ? 'sender' : 'receiver'}`}
                      >
                        <div 
                          className="message-bubble-wrapper"
                          onMouseEnter={() => setContextMenuMsgId(msg.id)}
                          onMouseLeave={() => setContextMenuMsgId(null)}
                        >
                          <div className="message-bubble">
                            {/* Reply preview inside bubble */}
                            {msg.reply_message && (
                              <div className="bubble-reply-preview">
                                <div className="reply-sender-name">{msg.reply_message.sender_name}</div>
                                <div>{msg.reply_message.content || '📷 Attachment'}</div>
                              </div>
                            )}

                            {/* Message content */}
                            {msg.deleted_at ? (
                              <span className="deleted-message">This message was deleted.</span>
                            ) : msg.content_type === 'image' && msg.media_url ? (
                              signedUrls[msg.media_url] ? (
                                <img 
                                  src={signedUrls[msg.media_url]} 
                                  alt="Attachment" 
                                  className="bubble-image"
                                  onClick={() => setActiveImage(signedUrls[msg.media_url!])}
                                />
                              ) : (
                                <div style={{ display: 'flex', gap: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>
                                  <Loader2 className="spinner" size={16} /> Loading media...
                                </div>
                              )
                            ) : (
                              <span style={{ fontSize: msg.content_type === 'emoji' ? '28px' : 'inherit' }}>
                                {msg.content}
                              </span>
                            )}

                            <span className="message-meta">
                              {new Date(msg.created_at).toLocaleTimeString(undefined, { 
                                hour: '2-digit', 
                                minute: '2-digit',
                                hour12: false
                              })}
                              {isOwn && (
                                <span style={{ marginLeft: '4px' }}>
                                  {msg.is_read ? '✓✓' : '✓'}
                                </span>
                              )}
                            </span>
                          </div>

                          {/* Hover Action Menu */}
                          {!msg.deleted_at && contextMenuMsgId === msg.id && (
                            <div 
                              style={{ 
                                position: 'absolute',
                                top: '-34px',
                                right: isOwn ? '0' : 'auto',
                                left: isOwn ? 'auto' : '0',
                                display: 'flex',
                                gap: '4px',
                                backgroundColor: 'var(--bg-card)',
                                border: '1px solid var(--border-color)',
                                padding: '4px 8px',
                                borderRadius: 'var(--radius-sm)',
                                boxShadow: 'var(--shadow-sm)',
                                zIndex: 10
                              }}
                            >
                              {!activeConvo.is_random_chat && (
                                <button 
                                  title="Reply"
                                  onClick={() => setReplyMessage(msg)}
                                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)' }}
                                >
                                  <CornerDownRight size={14} />
                                </button>
                              )}
                              {isOwn && (
                                <button 
                                  title="Delete"
                                  onClick={() => handleDeleteMessage(msg.id)}
                                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--danger)' }}
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          )}
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

            {/* Quoted Reply Preview */}
            {replyMessage && (
              <div className="reply-bar-preview">
                <div className="reply-bar-content">
                  <div className="reply-bar-title">
                    Replying to {replyMessage.sender_id === currentUserId ? 'yourself' : activeConvo.partner.display_name}
                  </div>
                  <div className="reply-bar-text">
                    {replyMessage.content_type === 'image' ? '📷 Attachment' : replyMessage.content}
                  </div>
                </div>
                <button 
                  onClick={() => setReplyMessage(null)} 
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  <X size={18} />
                </button>
              </div>
            )}

            {/* Input Bar */}
            <div className="chat-input-bar">
              {/* Attachment Picker (Disabled in Random Chat) */}
              {!activeConvo.is_random_chat ? (
                <>
                  <label className="input-action-btn" style={{ cursor: uploading ? 'not-allowed' : 'pointer' }}>
                    {uploading ? (
                      <Loader2 className="spinner" size={20} />
                    ) : (
                      <Paperclip size={20} />
                    )}
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handleFileUpload} 
                      style={{ display: 'none' }}
                      disabled={uploading}
                    />
                  </label>
                </>
              ) : null}

              {/* Emoji overlay toggler */}
              <div style={{ position: 'relative' }}>
                <button 
                  className="input-action-btn"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                >
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
                    {EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => {
                          setInputText(prev => prev + emoji);
                          setShowEmojiPicker(false);
                          chatInputRef.current?.focus();
                        }}
                        style={{ 
                          fontSize: '20px', 
                          border: 'none', 
                          background: 'transparent', 
                          cursor: 'pointer',
                          padding: '6px',
                          borderRadius: '4px'
                        }}
                        className="btn-secondary"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Text input */}
              <textarea
                ref={chatInputRef}
                className="chat-input-field"
                placeholder="Type a message..."
                rows={1}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                maxLength={2000}
              />

              {/* Characters indicator if near limit */}
              {inputText.length > 1800 && (
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                  {2000 - inputText.length}
                </span>
              )}

              {/* Send Button */}
              <button 
                className="btn btn-primary"
                style={{ 
                  borderRadius: '50%', 
                  width: '38px', 
                  height: '38px', 
                  padding: 0, 
                  flexShrink: 0 
                }}
                onClick={() => handleSendMessage()}
                disabled={!inputText.trim()}
              >
                <Send size={16} />
              </button>
            </div>
          </>
        ) : (
          /* Empty Chat Room State */
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
            <MessageSquare size={64} style={{ opacity: 0.15, marginBottom: '16px' }} />
            <h3 style={{ fontWeight: 600 }}>Welcome to ChatterBox</h3>
            <p style={{ fontSize: '14px', marginTop: '6px' }}>Select a chat from the sidebar or find a user to start messaging.</p>
          </div>
        )}
      </div>

      {/* Lightbox for Image Message clicks */}
      {activeImage && (
        <Lightbox src={activeImage} onClose={() => setActiveImage(null)} />
      )}
    </div>
  );
};
