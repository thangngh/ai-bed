import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { HomeScreen } from './components/HomeScreen';
import { FormScreen } from './components/FormScreen';
import { LoadingScreen } from './components/LoadingScreen';
import { StoryViewScreen } from './components/StoryViewScreen';
import { FeedbackScreen } from './components/FeedbackScreen';
import { SavedStoriesModal } from './components/SavedStoriesModal';
import { ProfileManager } from './components/ProfileManager';
import { ErrorScreen } from './components/ErrorScreen';
import { ChildSelector } from './components/ChildSelector';
import { AppScreen, BedtimeStory, FeedbackData, StoryFormInput, ChildProfile } from './types';
import { SAMPLE_STORIES } from './data/sampleStories';
import { generateBedtimeStory, mapSectionsToSegments } from './utils/storyGenerator';
import { apiClient } from './utils/api';
import { childClient } from './utils/childClient';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('home');
  const [isNightMode, setIsNightMode] = useState<boolean>(true); // Default to cozy night reading theme

  // Active story and form state
  const [activeStory, setActiveStory] = useState<BedtimeStory | null>(null);
  const [lastInput, setLastInput] = useState<StoryFormInput | null>(null);
  const [lastErrorType, setLastErrorType] = useState<'network' | 'timeout' | 'server' | 'unknown'>('unknown');

  // Saved Stories Collection in localStorage
  const [savedStories, setSavedStories] = useState<BedtimeStory[]>(() => {
    try {
      const stored = localStorage.getItem('bedtime_saved_stories');
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.error('Failed to load saved stories', e);
    }
    return SAMPLE_STORIES; // Initialize with sample stories if empty
  });

  const [isSavedModalOpen, setIsSavedModalOpen] = useState(false);
  const [beStories, setBeStories] = useState<BedtimeStory[]>([]);
  const [isLoadingStories, setIsLoadingStories] = useState(false);

  // Child profile state
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [isOffline, setIsOffline] = useState(false);
  const [activeChild, setActiveChild] = useState<ChildProfile | null>(() => {
    try {
      const cached = localStorage.getItem('bsc_active_child');
      return cached ? JSON.parse(cached) : null;
    } catch { return null; }
  });
  const [isChildSelectorOpen, setIsChildSelectorOpen] = useState(false);

  // Sync activeChild to localStorage
  useEffect(() => {
    if (activeChild) localStorage.setItem('bsc_active_child', JSON.stringify(activeChild));
    else localStorage.removeItem('bsc_active_child');
  }, [activeChild]);

  // Fetch children on mount
  useEffect(() => {
    childClient.list()
      .then((list) => {
        setChildren(list);
        setIsOffline(false);
        localStorage.setItem('bsc_children_cache', JSON.stringify(list));
      })
      .catch(() => {
        setIsOffline(true);
        try {
          const cached = localStorage.getItem('bsc_children_cache');
          if (cached) setChildren(JSON.parse(cached));
        } catch {}
      });
  }, []);

  // Sync saved stories to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('bedtime_saved_stories', JSON.stringify(savedStories));
    } catch (e) {
      console.error('Failed to save stories to localStorage', e);
    }
  }, [savedStories]);

  const fetchStoriesFromBE = async () => {
    setIsLoadingStories(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (activeChild) params.set('child_name', activeChild.childName);
      const data = await apiClient<any>(`/story/latest?${params.toString()}`);
      const list = data.stories || [];
      setBeStories(list.map((s: any) => ({
        id: `be-${s.story_id}`,
        title: s.title,
        childName: '',
        childAge: 0,
        topic: s.theme || '',
        segments: {
          opening: s.title,
          situation: '', interaction1: '', challenge: '',
          interaction2: '', ending: '', interaction3: '', moralSummary: '',
        },
        createdAt: s.created_at,
      })));
    } catch {
      console.warn('Failed to fetch BE stories');
    } finally {
      setIsLoadingStories(false);
    }
  };

  // Handle child selection
  const handleSelectChild = (child: ChildProfile | null) => {
    if (currentScreen !== 'home' && currentScreen !== 'form' && currentScreen !== 'profile') {
      alert('Đang đọc/xem truyện. Về trang chủ để chọn bé khác.');
      return;
    }
    setActiveChild(child);
  };

  // Auto-open child selector when no children exist
  useEffect(() => {
    if (children.length === 0 && currentScreen === 'form') {
      setIsChildSelectorOpen(true);
    }
  }, [children.length, currentScreen]);

  // Handle Form Submission
  const handleFormSubmit = async (input: StoryFormInput) => {
    setLastInput(input);
    setCurrentScreen('loading');

    try {
      const newStory = await generateBedtimeStory(input);
      setActiveStory(newStory);
      setCurrentScreen('story');
    } catch (err) {
      console.error('Story generation error:', err);
      setLastErrorType(getErrorType(err));
      setCurrentScreen('error');
    }
  };

  const getErrorType = (err: any): 'network' | 'timeout' | 'server' | 'unknown' => {
    const msg = err?.message || '';
    if (msg.includes('fetch') || msg.includes('Network')) return 'network';
    if (msg.includes('timeout') || msg.includes('Timeout')) return 'timeout';
    if (msg.includes('5') || msg.includes('server') || msg.includes('Server')) return 'server';
    return 'unknown';
  };

  // Save story to collection
  const handleSaveStory = (storyToSave: BedtimeStory) => {
    if (savedStories.some((s) => s.id === storyToSave.id)) {
      setSavedStories((prev) => prev.filter((s) => s.id !== storyToSave.id));
    } else {
      setSavedStories((prev) => [storyToSave, ...prev]);
    }
  };

  // Delete saved story
  const handleDeleteSavedStory = (id: string) => {
    setSavedStories((prev) => prev.filter((s) => s.id !== id));
  };

  const handleReadAgain = async () => {
    if (!activeStory) return;
    const storyId = activeStory.id;
    if (storyId.startsWith('be-')) {
      try {
        const data = await apiClient<any>(`/story/${storyId.replace('be-', '')}`);
        const storyData = data.data || data;
        const sections = storyData.sections || [];
        const segments = mapSectionsToSegments(sections);
        setActiveStory(prev => prev ? { ...prev, segments, title: storyData.title || prev.title } : prev);
      } catch {
        // fallback: just scroll
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Handle Feedback Submission
  const handleFeedbackSubmit = async (feedback: FeedbackData) => {
    try {
      const payload: Record<string, any> = {
        story_id: feedback.storyId,
        child_name: activeStory?.childName || '',
        rating: feedback.suitabilityRating,
        note: feedback.comment || '',
      };
      if (feedback.listenedUntilEnd != null) {
        payload.listened_complete = feedback.listenedUntilEnd ? 1 : 0;
      }
      if (feedback.wantsMoreStories) {
        payload.wants_more = feedback.wantsMoreStories === 'yes' ? 1 : feedback.wantsMoreStories === 'no' ? 0 : -1;
      }
      if (feedback.suitabilityRating) {
        payload.suitable = feedback.suitabilityRating >= 4 ? 1 : 0;
      }

      await apiClient('/story/feedback', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.warn('BE feedback failed, saving locally:', err);
      try {
        const existing = localStorage.getItem('bedtime_feedbacks');
        const list = existing ? JSON.parse(existing) : [];
        list.push({ ...feedback, createdAt: new Date().toISOString() });
        localStorage.setItem('bedtime_feedbacks', JSON.stringify(list));
      } catch (e) {
        console.error('Failed to store feedback', e);
      }
    }
  };

  // Select a story from preset / saved modal
  const handleSelectStory = async (story: BedtimeStory) => {
    if (story.id.startsWith('be-')) {
      try {
        const data = await apiClient<any>(`/story/${story.id.replace('be-', '')}`);
        const fullStory = data.data || data;
        const sections = fullStory.sections || [];
        const segments = mapSectionsToSegments(sections);
        setActiveStory({
          id: story.id,
          title: fullStory.title,
          childName: fullStory.child_name || '',
          childAge: fullStory.age || 4,
          topic: fullStory.theme || '',
          lesson: fullStory.goal || '',
          segments,
          createdAt: fullStory.created_at,
        });
      } catch {
        return; // Stay on current screen
      }
    } else {
      setActiveStory(story);
    }
    setCurrentScreen('story');
  };

  return (
    <div
      className={`min-h-screen transition-colors duration-300 font-sans ${
        isNightMode
          ? 'bg-slate-950 text-slate-100'
          : 'bg-amber-50/70 text-amber-950'
      }`}
    >
      {/* Header */}
      <Header
        currentScreen={currentScreen}
        setScreen={setCurrentScreen}
        isNightMode={isNightMode}
        setIsNightMode={setIsNightMode}
        savedStoriesCount={savedStories.length}
        onOpenSavedStories={() => {
          fetchStoriesFromBE();
          setIsSavedModalOpen(true);
        }}
        activeChild={activeChild}
        onOpenChildSelector={() => setIsChildSelectorOpen(true)}
        isOffline={isOffline}
      />

      {/* Main Container */}
      <main className="max-w-4xl mx-auto px-4 pb-16">
        {currentScreen === 'home' && (
          <HomeScreen
            onStartNewStory={() => setCurrentScreen('form')}
            onSelectPresetStory={handleSelectStory}
            presetStories={SAMPLE_STORIES}
            isNightMode={isNightMode}
            activeChild={activeChild}
          />
        )}

        {currentScreen === 'form' && (
          <FormScreen
            onSubmit={handleFormSubmit}
            onBack={() => setCurrentScreen('home')}
            isNightMode={isNightMode}
            activeChild={activeChild}
          />
        )}

        {currentScreen === 'loading' && (
          <LoadingScreen
            childName={lastInput?.childName}
            isNightMode={isNightMode}
          />
        )}

        {currentScreen === 'story' && activeStory && (
          <StoryViewScreen
            story={activeStory}
            onReadAgain={handleReadAgain}
            onCreateNew={() => setCurrentScreen('form')}
            onGoToFeedback={() => setCurrentScreen('feedback')}
            onSaveStory={handleSaveStory}
            isSaved={savedStories.some((s) => s.id === activeStory.id)}
            isNightMode={isNightMode}
          />
        )}

        {currentScreen === 'feedback' && activeStory && (
          <FeedbackScreen
            storyId={activeStory.id}
            childName={activeStory.childName}
            onSubmitFeedback={handleFeedbackSubmit}
            onStartNewStory={() => setCurrentScreen('form')}
            isNightMode={isNightMode}
          />
        )}

        {currentScreen === 'error' && (
          <ErrorScreen
            onRetry={() => {
              if (lastInput) handleFormSubmit(lastInput);
              else setCurrentScreen('form');
            }}
            onGoHome={() => setCurrentScreen('home')}
            isNightMode={isNightMode}
            errorType={lastErrorType}
          />
        )}
      {currentScreen === 'profile' && (
          <ProfileManager
            children={children}
            activeChild={activeChild}
            onSelectChild={handleSelectChild}
            onUpdate={setChildren}
            onBack={() => setCurrentScreen('home')}
            isNightMode={isNightMode}
          />
        )}
      </main>

      {/* Footer */}
      <footer
        className={`py-6 border-t text-center text-xs opacity-75 ${
          isNightMode ? 'border-slate-800 text-slate-400' : 'border-amber-200/60 text-amber-900'
        }`}
      >
        <p>Bedtime Story Companion • Dành cho giấc ngủ dịu dạo của bé 3-6 tuổi</p>
      </footer>

      {/* Child Selector Modal */}
      <ChildSelector
        isOpen={isChildSelectorOpen}
        onClose={() => setIsChildSelectorOpen(false)}
        children={children}
        activeChild={activeChild}
        onSelect={handleSelectChild}
        onAddNew={() => { setIsChildSelectorOpen(false); setCurrentScreen('profile'); }}
        onEdit={(child) => { setIsChildSelectorOpen(false); setCurrentScreen('profile'); }}
        isNightMode={isNightMode}
      />

      {/* Saved Stories Drawer Modal */}
      <SavedStoriesModal
        isOpen={isSavedModalOpen}
        onClose={() => setIsSavedModalOpen(false)}
        savedStories={savedStories}
        beStories={beStories}
        isLoadingBeStories={isLoadingStories}
        onSelectStory={handleSelectStory}
        onDeleteStory={handleDeleteSavedStory}
        isNightMode={isNightMode}
        activeChild={activeChild}
      />
    </div>
  );
}
