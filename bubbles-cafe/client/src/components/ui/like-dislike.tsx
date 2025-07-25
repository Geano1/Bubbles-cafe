import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { createCSRFRequest } from "@/lib/csrf-token";

interface LikeDislikeProps {
  postId: number;
  userLikeStatus?: 'like' | 'dislike' | null;
  onLike?: (liked: boolean) => void;
  onDislike?: (disliked: boolean) => void;
  onUpdate?: (likes: number, dislikes: number) => void;
  className?: string;
  variant?: 'index' | 'reader';
  size?: 'sm' | 'md' | 'lg';
}

interface ReactionStats {
  likesCount: number;
  dislikesCount: number;
}

// Get the user's interaction status for this post from local storage
const getUserInteraction = (postId: number): { liked: boolean, disliked: boolean } => {
  try {
    const storageKey = `post-interaction-${postId}`;
    const savedInteraction = localStorage.getItem(storageKey);
    
    if (savedInteraction) {
      const parsed = JSON.parse(savedInteraction);
      if (parsed && typeof parsed.liked === 'boolean' && typeof parsed.disliked === 'boolean') {
        return parsed;
      }
    }
    return { liked: false, disliked: false };
  } catch (error) {
    console.error(`[LikeDislike] Error getting user interaction for post ${postId}:`, error);
    return { liked: false, disliked: false };
  }
};

// Save the user's interaction status for this post to local storage
const saveUserInteraction = (postId: number, liked: boolean, disliked: boolean) => {
  try {
    const storageKey = `post-interaction-${postId}`;
    localStorage.setItem(storageKey, JSON.stringify({ liked, disliked }));
  } catch (error) {
    console.error(`[LikeDislike] Error saving user interaction for post ${postId}:`, error);
  }
};

export function LikeDislike({
  postId,
  userLikeStatus = null,
  onLike,
  onDislike,
  onUpdate,
  className,
  variant = 'index',
  size = 'sm'
}: LikeDislikeProps) {
  const { toast } = useToast();
  
  // Get the initial user interaction from localStorage
  const initialInteraction = getUserInteraction(postId);
  
  // Initialize state from local storage or props
  const [liked, setLiked] = useState(userLikeStatus === 'like' || initialInteraction.liked);
  const [disliked, setDisliked] = useState(userLikeStatus === 'dislike' || initialInteraction.disliked);
  
  // Initialize stats from localStorage if available for instant loading
  const getStoredStats = () => {
    try {
      const stored = localStorage.getItem(`post-stats-${postId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { likesCount: parsed.likesCount || 0, dislikesCount: parsed.dislikesCount || 0 };
      }
    } catch (error) {
      console.warn('Failed to parse stored stats:', error);
    }
    return { likesCount: 0, dislikesCount: 0 };
  };
  
  const [stats, setStats] = useState<ReactionStats>(getStoredStats());
  const [isLoading, setIsLoading] = useState(false); // Start with false for instant display
  const [isProcessing, setIsProcessing] = useState(false);

  // Function to persist stats to localStorage
  const persistStats = (newStats: ReactionStats) => {
    try {
      localStorage.setItem(`post-stats-${postId}`, JSON.stringify(newStats));
    } catch (error) {
      console.warn('Failed to persist stats:', error);
    }
  };

  // Fetch the current reaction counts from the server
  useEffect(() => {
    const fetchReactionCounts = async () => {
      // Check if post ID is valid before making the request
      if (!postId || isNaN(Number(postId))) {
        console.warn(`[LikeDislike] Invalid post ID: ${postId}`);
        setStats({ likesCount: 0, dislikesCount: 0 });
        setIsLoading(false);
        return;
      }
      
      try {
        setIsLoading(true);
        console.log(`[LikeDislike] Fetching reaction counts for post ${postId}`);
        
        // Add timestamp to prevent caching
        const timestamp = new Date().getTime();
        
        // Get request with proper headers - no need for CSRF token for GET requests
        const headers = new Headers();
        headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        headers.set('Pragma', 'no-cache');
        
        const response = await fetch(`/api/no-csrf/reactions/${postId}?t=${timestamp}`, {
          headers,
          credentials: 'include' // Include cookies for session identification
        });
        
        // Special handling for 404s - just return 0 counts without error
        if (response.status === 404) {
          console.log(`[LikeDislike] Post ${postId} not found, using zero counts`);
          setStats({ likesCount: 0, dislikesCount: 0 });
          setIsLoading(false);
          return;
        }
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[LikeDislike] Server error: ${response.status}`, errorText);
          throw new Error(`Failed to fetch reaction counts: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`[LikeDislike] Received counts for post ${postId}:`, data);
        
        if (typeof data.likesCount === 'number' && typeof data.dislikesCount === 'number') {
          const newStats = {
            likesCount: data.likesCount,
            dislikesCount: data.dislikesCount
          };
          setStats(newStats);
          persistStats(newStats);
        } else {
          console.error(`[LikeDislike] Invalid data format from server:`, data);
          // Use default zero counts on invalid format
          const defaultStats = { likesCount: 0, dislikesCount: 0 };
          setStats(defaultStats);
          persistStats(defaultStats);
        }
      } catch (error) {
        // Don't log as error for 404s since we handle those separately
        if (error instanceof Error && !error.message.includes('404')) {
          console.error(`[LikeDislike] Error fetching reaction counts for post ${postId}:`, error);
        }
        // Use default zero counts on error
        setStats({ likesCount: 0, dislikesCount: 0 });
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchReactionCounts();
  }, [postId]);

  // Handle sending reaction to the server and updating local state
  const sendReaction = async (isLike: boolean | null) => {
    // Check if post ID is valid before making the request
    if (!postId || isNaN(Number(postId))) {
      console.warn(`[LikeDislike] Invalid post ID: ${postId}, cannot send reaction`);
      return false;
    }
    
    try {
      console.log(`[LikeDislike] Sending reaction for post ${postId}:`, isLike);
      
      // Add a timestamp parameter to prevent caching
      const timestamp = new Date().getTime();
      
      // Use CSRF request helper to ensure token is included
      const requestOptions = createCSRFRequest('POST', { isLike });
      
      // Add cache control headers without overriding existing headers
      const headers = new Headers(requestOptions.headers || {});
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      headers.set('Pragma', 'no-cache');
      
      console.log(`[LikeDislike] Request headers for post ${postId}:`, 
        Array.from(headers.entries()));
      
      // Log the actual URL and request details before making the request
      const apiUrl = `/api/no-csrf/posts/${postId}/reaction?t=${timestamp}`;
      console.log(`[LikeDislike] Sending POST request to: ${apiUrl}`);
      console.log(`[LikeDislike] Request body:`, { isLike });
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ isLike })
      });
      
      // Log response status for debugging
      console.log(`[LikeDislike] Response status: ${response.status}`);
      
      // If there's an error, try to log the response text
      if (!response.ok) {
        try {
          const errorText = await response.text();
          console.error(`[LikeDislike] Error response: ${errorText}`);
          // Return a cloned response since we consumed the body
          return new Response(errorText, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        } catch (e) {
          console.error(`[LikeDislike] Failed to read error response:`, e);
        }
      }
      
      // Special handling for 404s
      if (response.status === 404) {
        console.log(`[LikeDislike] Post ${postId} not found, cannot update reaction`);
        // Return false but don't throw an error - this is expected for non-existent posts
        return false;
      }
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[LikeDislike] Server error: ${response.status}`, errorText);
        throw new Error(`Failed to send reaction: ${response.status}`);
      }
      
      const data = await response.json();
      console.log(`[LikeDislike] Reaction response for post ${postId}:`, data);
      
      // Update stats with server counts
      if (typeof data.likesCount === 'number' && typeof data.dislikesCount === 'number') {
        setStats({
          likesCount: data.likesCount,
          dislikesCount: data.dislikesCount
        });
        
        // Notify parent component of the update
        onUpdate?.(data.likesCount, data.dislikesCount);
        return true;
      } else {
        console.warn(`[LikeDislike] Invalid data format from server:`, data);
        // Use values from the response if available, otherwise default to 0
        const likesCount = Number(data?.likesCount || 0);
        const dislikesCount = Number(data?.dislikesCount || 0);
        
        setStats({ likesCount, dislikesCount });
        onUpdate?.(likesCount, dislikesCount);
        return true;
      }
    } catch (error) {
      // Don't log as error for 404s since we handle those separately
      if (error instanceof Error && !error.message.includes('404')) {
        console.error(`[LikeDislike] Error sending reaction for post ${postId}:`, error);
      }
      return false;
    }
  };

  const handleLike = async () => {
    // Prevent multiple rapid clicks
    if (isProcessing) return;
    
    try {
      setIsProcessing(true);
      
      // Capture current state for perfect toggle logic
      const wasLiked = liked;
      const wasDisliked = disliked;
      
      // Calculate new state with absolute mathematical certainty
      const willBeLiked = !wasLiked;
      const willBeDisliked = wasDisliked && willBeLiked ? false : wasDisliked;
      
      // Update UI state instantly for immediate feedback
      setLiked(willBeLiked);
      setDisliked(willBeDisliked);
      
      // Save to localStorage immediately
      saveUserInteraction(postId, willBeLiked, willBeDisliked);
      
      // Only send to server if state actually changed
      if (wasLiked !== willBeLiked) {
        await sendReaction(willBeLiked ? true : null);
        
        if (willBeLiked) {
          toast({
            description: "Thanks for liking!"
          });
        }
      }
      
      // Call callback
      onLike?.(willBeLiked);
      
    } catch (error) {
      console.error(`[LikeDislike] Error handling like:`, error);
      // Revert UI state on error
      setLiked(liked);
      setDisliked(disliked);
      toast({
        title: "Error updating like",
        description: "Please try again",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDislike = async () => {
    // Prevent multiple rapid clicks
    if (isProcessing) return;
    
    try {
      setIsProcessing(true);
      
      // Capture current state for perfect toggle logic
      const wasLiked = liked;
      const wasDisliked = disliked;
      
      // Calculate new state with absolute mathematical certainty
      const willBeDisliked = !wasDisliked;
      const willBeLiked = wasLiked && willBeDisliked ? false : wasLiked;
      
      // Update UI state instantly for immediate feedback
      setLiked(willBeLiked);
      setDisliked(willBeDisliked);
      
      // Save to localStorage immediately
      saveUserInteraction(postId, willBeLiked, willBeDisliked);
      
      // Only send to server if state actually changed
      if (wasDisliked !== willBeDisliked) {
        await sendReaction(willBeDisliked ? false : null);
        
        if (willBeDisliked) {
          toast({
            description: "Thanks for the feedback!"
          });
        }
      }
      
      // Call callback
      onDislike?.(willBeDisliked);
      
    } catch (error) {
      console.error(`[LikeDislike] Error handling dislike:`, error);
      // Revert UI state on error
      setLiked(liked);
      setDisliked(disliked);
      toast({
        title: "Error updating dislike",
        description: "Please try again",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className={cn(
      variant === 'reader' ? "mt-4 flex flex-col items-center gap-y-2" : "flex items-center gap-x-3", 
      className
    )} data-toast-container>
      {variant === 'reader' && (
        <h3 className="text-gray-800 dark:text-white text-lg font-semibold">
          Loved this story? Let me know with a like 🥹—or a dislike if you must 😔
        </h3>
      )}
      <div className={cn(
        "flex items-center",
        variant === 'reader' ? "justify-center gap-x-4" : "gap-x-2"
      )}>
        {/* Like Button - Enhanced design */}
        <button 
          type="button" 
          onClick={handleLike}
          disabled={isProcessing}
          className={cn(
            "inline-flex items-center justify-center gap-x-2 font-semibold rounded-lg transition-all duration-150 transform hover:scale-105 disabled:opacity-50 disabled:pointer-events-none",
            // Base styling
            "bg-white border border-slate-200 text-slate-700 shadow-sm hover:shadow-md",
            "dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300",
            // Size variants - made larger
            variant === 'reader' ? (
              size === 'lg' ? "py-4 px-6 text-lg min-w-[130px]" : 
              size === 'md' ? "py-3 px-5 text-base min-w-[110px]" : 
              "py-3 px-4 text-base min-w-[100px]"
            ) : (
              size === 'lg' ? "py-2.5 px-4 text-sm h-10" :
              size === 'md' ? "py-2 px-3 text-sm h-9" :
              "py-1.5 px-2.5 text-xs h-8"
            ),
            // Active state styling
            liked && "border-green-400 bg-green-50 text-green-700 shadow-green-200",
            liked && "dark:border-green-500 dark:bg-green-900/30 dark:text-green-400",
            // Hover effects
            !liked && "hover:border-green-300 hover:bg-green-50/70 hover:text-green-600",
            !liked && "dark:hover:border-green-600 dark:hover:bg-green-900/20 dark:hover:text-green-400",
            // Processing state
            isProcessing && "cursor-wait"
          )}
        >
          <svg 
            className={cn(
              "shrink-0 transition-all duration-200",
              variant === 'reader' ? (
                size === 'lg' ? "w-5 h-5" : 
                size === 'md' ? "w-4 h-4" : 
                "w-4 h-4"
              ) : "w-4 h-4"
            )}
            xmlns="http://www.w3.org/2000/svg" 
            viewBox="0 0 24 24" 
            fill={liked ? "currentColor" : "none"}
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          >
            <path d="M7 10v12"></path>
            <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"></path>
          </svg>
          <span className="font-bold text-base">
            {isLoading ? '...' : stats.likesCount}
          </span>
        </button>

        {/* Dislike Button - Enhanced design */}
        <button 
          type="button" 
          onClick={handleDislike}
          disabled={isProcessing}
          className={cn(
            "inline-flex items-center justify-center gap-x-2 font-semibold rounded-lg transition-all duration-150 transform hover:scale-105 disabled:opacity-50 disabled:pointer-events-none",
            // Base styling
            "bg-white border border-slate-200 text-slate-700 shadow-sm hover:shadow-md",
            "dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300",
            // Size variants - made larger
            variant === 'reader' ? (
              size === 'lg' ? "py-4 px-6 text-lg min-w-[130px]" : 
              size === 'md' ? "py-3 px-5 text-base min-w-[110px]" : 
              "py-3 px-4 text-base min-w-[100px]"
            ) : (
              size === 'lg' ? "py-2.5 px-4 text-sm h-10" :
              size === 'md' ? "py-2 px-3 text-sm h-9" :
              "py-1.5 px-2.5 text-xs h-8"
            ),
            // Active state styling
            disliked && "border-red-400 bg-red-50 text-red-700 shadow-red-200",
            disliked && "dark:border-red-500 dark:bg-red-900/30 dark:text-red-400",
            // Hover effects
            !disliked && "hover:border-red-300 hover:bg-red-50/70 hover:text-red-600",
            !disliked && "dark:hover:border-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400",
            // Processing state
            isProcessing && "cursor-wait"
          )}
        >
          <svg 
            className={cn(
              "shrink-0 transition-all duration-200",
              variant === 'reader' ? (
                size === 'lg' ? "w-5 h-5" : 
                size === 'md' ? "w-4 h-4" : 
                "w-4 h-4"
              ) : "w-4 h-4"
            )}
            xmlns="http://www.w3.org/2000/svg"  
            viewBox="0 0 24 24" 
            fill={disliked ? "currentColor" : "none"}
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          >
            <path d="M17 14V2"></path>
            <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z"></path>
          </svg>
          <span className="font-bold text-base">
            {isLoading ? '...' : stats.dislikesCount}
          </span>
        </button>
      </div>
    </div>
  );
}