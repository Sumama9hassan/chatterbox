import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { Avatar } from '../components/Avatar';
import { 
  AlertTriangle, Shield, Mail, Moon, Sun, Monitor, Loader2, X
} from 'lucide-react';

interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
  bio: string | null;
  is_private: boolean;
  theme_preference: string;
}

interface BlockedUser {
  id: string;
  blocked_profile: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
  };
}

interface SettingsTabProps {
  currentUserId: string;
  userProfile: UserProfile | null;
  onProfileUpdate: () => void;
  onLogout: () => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  currentUserId,
  userProfile,
  onProfileUpdate,
  onLogout
}) => {
  // Profile fields
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [theme, setTheme] = useState('system');
  
  // States
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [loadingBlocks, setLoadingBlocks] = useState(false);

  // Dialogs
  const [showPrivacyConfirm, setShowPrivacyConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // 1. Load initial profile data
  useEffect(() => {
    if (userProfile) {
      setDisplayName(userProfile.display_name || '');
      setUsername(userProfile.username || '');
      setBio(userProfile.bio || '');
      setIsPrivate(userProfile.is_private || false);
      setTheme(userProfile.theme_preference || 'system');
    }
  }, [userProfile]);

  // 2. Fetch blocked users
  const fetchBlockedUsers = async () => {
    setLoadingBlocks(true);
    try {
      const { data, error } = await supabase
        .from('blocks')
        .select(`
          id,
          blocked_profile:users!blocks_blocked_id_fkey(id, username, display_name, avatar_url)
        `)
        .eq('blocker_id', currentUserId);

      if (error) throw error;
      setBlockedUsers((data || []) as any);
    } catch (err) {
      console.error('Error fetching blocked users:', err);
    } finally {
      setLoadingBlocks(false);
    }
  };

  useEffect(() => {
    fetchBlockedUsers();
  }, [currentUserId]);

  // 3. Image canvas crop & upload
  const resizeAndCropAvatar = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 256;
          canvas.height = 256;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('Canvas context not available'));
          
          // Draw center-cropped square
          const size = Math.min(img.width, img.height);
          const x = (img.width - size) / 2;
          const y = (img.height - size) / 2;
          ctx.drawImage(img, x, y, size, size, 0, 0, 256, 256);
          
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Blob conversion failed'));
          }, 'image/png');
        };
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Size limit (2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert('Avatar image exceeds 2MB limit.');
      return;
    }

    setUploadingAvatar(true);
    try {
      // Crop on device to 256x256 PNG
      const croppedBlob = await resizeAndCropAvatar(file);
      
      const fileName = `avatar_${Date.now()}.png`;
      const filePath = `${currentUserId}/${fileName}`;

      // Upload to avatars bucket (upsert)
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, croppedBlob, { contentType: 'image/png', upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      // Save to database
      const { error: updateError } = await supabase
        .from('users')
        .update({ avatar_url: publicUrl })
        .eq('id', currentUserId);

      if (updateError) throw updateError;
      
      // Cleanup old avatar from Storage if it exists
      if (userProfile?.avatar_url) {
        try {
          const oldPath = userProfile.avatar_url.split('/public/avatars/')[1];
          if (oldPath && oldPath !== filePath) {
            await supabase.storage.from('avatars').remove([oldPath]);
          }
        } catch (e) {
          // ignore cleanup errors
        }
      }

      onProfileUpdate();
    } catch (err: any) {
      console.error(err);
      alert(`Avatar upload failed: ${err.message}`);
    } finally {
      setUploadingAvatar(false);
    }
  };

  // 4. Save Profile changes
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);

    try {
      const cleanUsername = username.toLowerCase().trim();
      const formatRegex = /^[a-z0-9_]{3,30}$/;
      if (!formatRegex.test(cleanUsername)) {
        throw new Error('Username must be 3-30 characters containing only letters, numbers, and underscores.');
      }

      // Check username uniqueness if changed
      if (cleanUsername !== userProfile?.username) {
        const { data: isAvailable } = await supabase.rpc('check_username_available', {
          username_to_check: cleanUsername
        });
        if (!isAvailable) {
          throw new Error('Username is already taken.');
        }
      }

      const { error } = await supabase
        .from('users')
        .update({
          display_name: displayName.trim(),
          username: cleanUsername,
          bio: bio.trim(),
          theme_preference: theme
        })
        .eq('id', currentUserId);

      if (error) throw error;
      
      // Update local theme state immediately
      applyTheme(theme);
      onProfileUpdate();
      alert('Profile updated successfully!');
    } catch (err: any) {
      alert(`Error updating profile: ${err.message}`);
    } finally {
      setSavingProfile(false);
    }
  };

  // 5. Apply Theme Preference immediately
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

  // 6. Privacy control confirm toggle
  const handleTogglePrivacy = (checked: boolean) => {
    if (checked) {
      // Just toggle immediately
      updatePrivacy(true);
    } else {
      // Confirm impact when disabling privacy (making public)
      setShowPrivacyConfirm(true);
    }
  };

  const updatePrivacy = async (privateVal: boolean) => {
    try {
      const { error } = await supabase
        .from('users')
        .update({ is_private: privateVal })
        .eq('id', currentUserId);

      if (error) throw error;
      setIsPrivate(privateVal);
      onProfileUpdate();
    } catch (err: any) {
      alert(`Error updating privacy: ${err.message}`);
    }
  };

  // 7. Unblock user
  const handleUnblock = async (blockId: string, name: string) => {
    const confirm = window.confirm(`Are you sure you want to unblock ${name}?`);
    if (!confirm) return;

    try {
      const { error } = await supabase
        .from('blocks')
        .delete()
        .eq('id', blockId);

      if (error) throw error;
      // Refresh list
      fetchBlockedUsers();
    } catch (err: any) {
      alert(`Error unblocking user: ${err.message}`);
    }
  };

  // 8. Delete Account Cascade
  const handleDeleteAccount = async () => {
    setDeletingAccount(true);
    setDeleteError('');
    try {
      // 1. Verify password before deleting
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: userProfile?.email || '',
        password: confirmPassword
      });

      if (loginError) {
        throw new Error('Password confirmation failed. Please enter the correct password.');
      }

      // 2. Call delete RPC trigger to purge from database
      const { error: deleteError } = await supabase.rpc('delete_user_account');
      if (deleteError) throw deleteError;

      // 3. Clear auth session
      await supabase.auth.signOut();
      onLogout();
    } catch (err: any) {
      setDeleteError(err.message || 'An error occurred during deletion.');
      setDeletingAccount(false);
    }
  };

  // Feedback email compose helper
  const handleSendFeedback = () => {
    const supportEmail = 'support@chatterbox-app.com';
    const subject = encodeURIComponent('ChatterBox Web Feedback');
    const body = encodeURIComponent(
      `--- Device Info ---\n` +
      `Agent: ${navigator.userAgent}\n` +
      `Platform: Web App Client\n` +
      `User ID: ${currentUserId}\n\n` +
      `Feedback / Support query:\n`
    );
    window.open(`mailto:${supportEmail}?subject=${subject}&body=${body}`);
  };

  return (
    <div className="tab-container">
      <div className="tab-header">
        <h2 className="tab-title">Settings</h2>
        <button className="btn btn-secondary" onClick={() => supabase.auth.signOut().then(onLogout)}>
          Log Out
        </button>
      </div>

      <div className="tab-body">
        <div className="settings-grid">
          
          {/* Profile Section */}
          <form onSubmit={handleSaveProfile} className="settings-section">
            <div className="settings-section-title">Edit Profile</div>
            
            {/* Avatar Upload */}
            <div className="avatar-upload-row">
              <Avatar src={userProfile?.avatar_url} name={userProfile?.display_name || 'Me'} size={76} />
              
              <div className="flex flex-column gap-2" style={{ gap: '6px' }}>
                <label className="btn btn-secondary" style={{ cursor: uploadingAvatar ? 'not-allowed' : 'pointer' }}>
                  {uploadingAvatar ? <Loader2 className="spinner" size={16} /> : 'Change Photo'}
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleAvatarUpload} 
                    style={{ display: 'none' }}
                    disabled={uploadingAvatar}
                  />
                </label>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>JPG, PNG or WEBP. Max 2MB.</span>
              </div>
            </div>

            {/* Display Name input */}
            <div className="form-group">
              <label className="form-label">Display Name</label>
              <div className="input-wrapper">
                <input
                  type="text"
                  className="form-input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={60}
                  required
                />
              </div>
            </div>

            {/* Username input */}
            <div className="form-group">
              <label className="form-label">Username</label>
              <div className="input-wrapper">
                <input
                  type="text"
                  className="form-input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  maxLength={30}
                  required
                />
              </div>
            </div>

            {/* Bio input */}
            <div className="form-group">
              <label className="form-label">Biography</label>
              <textarea
                className="form-input"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={160}
                rows={3}
                placeholder="Tell others about yourself..."
                style={{ resize: 'none' }}
              />
              <div style={{ alignSelf: 'flex-end', fontSize: '11px', color: 'var(--text-muted)' }}>
                {160 - bio.length} characters remaining
              </div>
            </div>

            {/* Theme Toggle Selection */}
            <div className="form-group">
              <label className="form-label">Theme Preference</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`btn ${theme === 'light' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flexGrow: 1 }}
                  onClick={() => setTheme('light')}
                >
                  <Sun size={16} /> Light
                </button>
                <button
                  type="button"
                  className={`btn ${theme === 'dark' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flexGrow: 1 }}
                  onClick={() => setTheme('dark')}
                >
                  <Moon size={16} /> Dark
                </button>
                <button
                  type="button"
                  className={`btn ${theme === 'system' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flexGrow: 1 }}
                  onClick={() => setTheme('system')}
                >
                  <Monitor size={16} /> System
                </button>
              </div>
            </div>

            <button 
              type="submit" 
              className="btn btn-primary mt-4" 
              disabled={savingProfile}
              style={{ alignSelf: 'flex-start' }}
            >
              {savingProfile ? <Loader2 className="spinner" size={16} /> : 'Save Changes'}
            </button>
          </form>

          {/* Privacy Section */}
          <div className="settings-section">
            <div className="settings-section-title">Privacy Controls</div>
            <div className="toggle-row">
              <div className="toggle-info">
                <span className="toggle-title">Private Profile</span>
                <span className="toggle-desc">Exclude your profile from public searches and matchmaking.</span>
              </div>
              <label className="switch-control">
                <input 
                  type="checkbox" 
                  checked={isPrivate} 
                  onChange={(e) => handleTogglePrivacy(e.target.checked)}
                />
                <span className="slider" />
              </label>
            </div>
          </div>

          {/* Blocked list Section */}
          <div className="settings-section">
            <div className="settings-section-title">Blocked Users</div>
            {loadingBlocks ? (
              <div className="text-center"><Loader2 className="spinner" size={20} /></div>
            ) : blockedUsers.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>You haven't blocked any users yet.</p>
            ) : (
              <div className="flex flex-column gap-2" style={{ gap: '10px' }}>
                {blockedUsers.map((item) => (
                  <div 
                    key={item.id} 
                    className="flex align-center justify-between"
                    style={{ padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-app)' }}
                  >
                    <div className="flex align-center gap-2">
                      <Avatar src={item.blocked_profile.avatar_url} name={item.blocked_profile.display_name} size={36} />
                      <div className="user-info">
                        <span className="user-name" style={{ fontSize: '13.5px' }}>{item.blocked_profile.display_name}</span>
                        <span className="user-handle" style={{ fontSize: '11px' }}>@{item.blocked_profile.username}</span>
                      </div>
                    </div>
                    
                    <button 
                      className="btn btn-secondary" 
                      style={{ padding: '6px 12px', fontSize: '12px' }}
                      onClick={() => handleUnblock(item.id, item.blocked_profile.display_name)}
                    >
                      Unblock
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Danger Zone Account Deletion */}
          <div className="settings-section" style={{ borderColor: 'var(--danger)', backgroundColor: 'rgba(231, 76, 60, 0.02)' }}>
            <div className="settings-section-title" style={{ color: 'var(--danger)' }}>Danger Zone</div>
            <div className="flex justify-between align-center">
              <div>
                <span className="toggle-title" style={{ color: 'var(--danger)' }}>Delete Account</span>
                <p className="toggle-desc" style={{ marginTop: '4px' }}>Permanently erase your profiles, messages, attachments, and settings. This cannot be undone.</p>
              </div>
              
              <button 
                className="btn btn-danger"
                onClick={() => {
                  setConfirmPassword('');
                  setDeleteError('');
                  setShowDeleteConfirm(true);
                }}
              >
                Delete Forever
              </button>
            </div>
          </div>

          {/* Feedback & App Info */}
          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <button className="btn btn-outline" onClick={handleSendFeedback}>
              <Mail size={16} /> Send App Feedback
            </button>
            <div className="version-footer">
              ChatterBox Web v2.0.0-web
              <br />
              Secure End-To-End TLS 1.3
            </div>
          </div>

        </div>
      </div>

      {/* Privacy Warning Confirm dialog */}
      {showPrivacyConfirm && (
        <div className="modal-overlay" onClick={() => setShowPrivacyConfirm(false)}>
          <div className="modal-card" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Shield size={20} style={{ color: 'var(--primary)' }} /> Profile Privacy</div>
              <button className="input-action-btn" onClick={() => setShowPrivacyConfirm(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              Making your profile public allows other users to search for your username and permits you to enter the matchmaking pool in Random Chats. Do you wish to continue?
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowPrivacyConfirm(false)}>Cancel</button>
              <button 
                className="btn btn-primary" 
                onClick={() => {
                  setShowPrivacyConfirm(false);
                  updatePrivacy(false);
                }}
              >
                Confirm Make Public
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account 2-Step verification Dialog */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => !deletingAccount && setShowDeleteConfirm(false)}>
          <div className="modal-card" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title" style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={22} /> Delete Account Permanently
              </div>
              <button 
                className="input-action-btn" 
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deletingAccount}
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="modal-body">
              <p>This action is irreversible. All of your messages, statuses, files, and account metadata will be instantly purged from our servers.</p>
              
              <div className="form-group" style={{ marginTop: '20px' }}>
                <label className="form-label">Confirm Password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Enter your password to verify"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={deletingAccount}
                  required
                />
              </div>

              {deleteError && (
                <div className="form-error" style={{ marginTop: '10px' }}>
                  {deleteError}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button 
                className="btn btn-secondary" 
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deletingAccount}
              >
                Cancel
              </button>
              <button 
                className="btn btn-danger" 
                disabled={!confirmPassword || deletingAccount}
                onClick={handleDeleteAccount}
              >
                {deletingAccount ? <Loader2 className="spinner" size={16} /> : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
