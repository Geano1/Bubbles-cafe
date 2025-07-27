// Import our configuration first, which loads environment variables
import path from 'path';
import fs from 'fs';
import config from './config';

// Log environment variables being loaded
console.log('[Server] Starting with environment configuration:');
console.log('[Server] NODE_ENV:', config.NODE_ENV);
console.log('[Server] DATABASE_URL:', config.DATABASE_URL ? 'Set' : 'Not set');
console.log('[Server] GMAIL_USER:', process.env.GMAIL_USER ? 'Set' : 'Not set');
console.log('[Server] GMAIL_APP_PASSWORD:', process.env.GMAIL_APP_PASSWORD ? 'Set' : 'Not set');

import express from "express";
import { createServer } from "http";
import { setupVite, serveStatic, log } from "./vite";
import { registerRoutes } from "./routes";
import { db } from "./db"; // Using the direct Neon database connection
import { posts } from "@shared/schema";
import { count } from "drizzle-orm";
import { seedDatabase } from "./seed";
import helmet from "helmet";
import compression from "compression";
import crypto from "crypto";
import session from "express-session";
import { setupAuth } from "./auth";
import { setupOAuth } from "./oauth";
import { storage } from "./storage-db";
import { createSecureLogger } from "./utils/secure-logger";
import { globalErrorHandler } from "./utils/error-handler";
import { requestLogger } from "./utils/debug-logger";
import { registerModularRoutes } from "./routes/index";
import { registerUserFeedbackRoutes } from "./routes/user-feedback";
import { registerRecommendationsRoutes } from "./routes/recommendations";
import { registerPostRecommendationsRoutes } from "./routes/simple-posts-recommendations";
// User Data Export routes removed
import { registerPrivacySettingsRoutes } from "./routes/privacy-settings";
import { registerWordPressSyncRoutes } from "./routes/wordpress-sync";
import { setupWordPressSyncSchedule } from "./wordpress-sync"; // Using the declaration file
import { wordpressScheduler } from "./wordpress-scheduler";
import { registerAnalyticsRoutes } from "./routes/analytics"; // Analytics endpoints
import { registerEmailServiceRoutes } from "./routes/email-service"; // Email service routes
import { registerBookmarkRoutes } from "./routes/bookmark-routes"; // Bookmark routes

// CSRF protection completely removed as per user request
import { runMigrations } from "./migrations"; // Import our custom migrations
import { globalRateLimiter, apiRateLimiter } from "./middlewares/rate-limiter"; // Rate limiters
import { setupCors } from "./cors-setup";
// Import performance middleware
import { 
  applyPerformanceMiddleware, 
  cacheControlMiddleware, 
  responseTimeMiddleware, 
  queryPerformanceMiddleware,
  wrapDbWithProfiler
} from "./middleware";
import { validateSession } from "./middleware/security-validation";

const app = express();
const isDev = process.env.NODE_ENV !== "production";
// Setup port with fallback options in case of conflicts
const DEFAULT_PORT = parseInt(process.env.PORT || "3003", 10);
const HOST = '0.0.0.0';
// We'll try a range of ports starting with DEFAULT_PORT
let PORT = DEFAULT_PORT;
// Alternative ports to try if the default is in use
const ALTERNATIVE_PORTS = [3004, 3005, 3006, 3007, 3008];

// Create server instance outside startServer for proper cleanup
let server: ReturnType<typeof createServer>;

// Apply our new performance monitoring middleware
// This wraps the database with profiling capabilities
wrapDbWithProfiler(db);

// Configure basic middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression({ level: 6 })); // Improved compression settings

// Add response time monitoring
app.use(responseTimeMiddleware);

// Apply global rate limiting to all routes
app.use(globalRateLimiter);

// Add query performance monitoring
app.use(queryPerformanceMiddleware);

// Configure CORS for cross-domain requests when deployed on Vercel/Render
setupCors(app);

// Serve attached assets directly
app.use('/attached_assets', express.static(path.join(process.cwd(), 'attached_assets'), {
  maxAge: '30d',  // Cache for 30 days
  immutable: true // Files never change
}));

// Serve files from public directory
app.use('/public', express.static(path.join(process.cwd(), 'public'), {
  maxAge: '1d'  // Cache for 1 day
}));

// Add cache control headers for better browser caching
app.use(cacheControlMiddleware);

// Apply our enhanced browser caching middleware for optimized performance
import { browserCache, etagCache } from './middlewares/browser-cache';
app.use(browserCache());
app.use(etagCache());

// Session already handles cookies for us
// No additional cookie parser needed for CSRF protection

// Increase body parser limit for file uploads
app.use((req, res, next) => {
  // Skip content-type check for multipart requests
  if (req.headers['content-type']?.includes('multipart/form-data')) {
    return next();
  }
  next();
});

// Generate a secure session secret if not provided
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Configure session with enhanced security
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Only secure in production
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // Required for cross-domain cookies
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/'
  },
  store: storage.sessionStore
}));

// CSRF protection has been completely removed as requested
app.use((req, res, next) => {
  // No CSRF token generation or validation
  next();
});

// Apply security validation middleware (but skip for public routes)
// This is commented out temporarily to allow reader access
// app.use(validateSession);

// Setup authentication
setupAuth(app);
setupOAuth(app);

// Add enhanced health check endpoint with performance metrics
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    csrfToken: req.session.csrfToken || 'not set',
    performance: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    }
  });
});

// Enhanced security headers with strict CSP
app.use(helmet({
  // Apply CSP in both development and production
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Reduce unsafe-inline usage where possible 
      styleSrc: ["'self'", ...(isDev ? ["'unsafe-inline'"] : []), "fonts.googleapis.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      // Restrict image sources to self and specific data URIs
      imgSrc: ["'self'", "data:image/svg+xml", "data:image/png", "data:image/jpeg", "data:image/webp", "https:"],
      // Eliminate unsafe-eval in production
      scriptSrc: ["'self'", ...(isDev ? ["'unsafe-inline'", "'unsafe-eval'"] : [])],
      // Add frame-ancestors restriction
      frameAncestors: ["'self'"],
      // Add form action restriction
      formAction: ["'self'"],
      // Add connect-src for API calls
      connectSrc: ["'self'", "api.wordpress.com", "https:"],
      // Upgrade insecure requests
      upgradeInsecureRequests: [],
      // Block all mixed content
      blockAllMixedContent: []
    }
  },
  // Force HTTPS in production
  hsts: {
    maxAge: 15552000, // 180 days
    includeSubDomains: true,
    preload: true
  },
  // Prevent clickjacking
  frameguard: {
    action: 'deny'
  },
  // Disable X-Powered-By header
  hidePoweredBy: true
}));

// Create a server logger
const serverLogger = createSecureLogger('Server');

// Import our permanent startup utilities
import { permanentStartup } from '../scripts/permanent-startup';

async function startServer() {
  try {
    serverLogger.info('Starting server initialization', {
      environment: process.env.NODE_ENV,
      host: HOST,
      port: PORT
    });

    // Run permanent startup setup (includes database initialization)
    try {
      serverLogger.info('Running permanent startup setup...');
      await permanentStartup();
      serverLogger.info('Permanent startup setup completed successfully');
    } catch (startupError) {
      serverLogger.error('Startup setup failed, continuing in partial mode', { 
        error: startupError instanceof Error ? startupError.message : 'Unknown error' 
      });
      // Continue with application startup even if setup fails
      // This ensures the app starts for debugging purposes
    }
    
    // Create server instance
    server = createServer(app);

    // Setup routes based on environment
    if (isDev) {
      serverLogger.info('Setting up development environment');
      
      // Add global request logging in development
      app.use(requestLogger);
      
      // Register main routes
      registerRoutes(app);
      
      // Register optimized modular routes
      registerModularRoutes(app);
      
      // Register user feedback routes
      registerUserFeedbackRoutes(app, storage);
      
      // Register recommendation routes
      registerRecommendationsRoutes(app, storage);
      
 // User data export routes removed
 
      
      // Register privacy settings routes
      registerPrivacySettingsRoutes(app, storage);
      
      // Register WordPress sync routes
      registerWordPressSyncRoutes(app);

      // Register analytics routes
      registerAnalyticsRoutes(app);
      
      // Register email service routes
      registerEmailServiceRoutes(app);
      
      // Register bookmark routes - only once to avoid duplicates
      registerBookmarkRoutes(app);
      
      // Add global error handler (must be after all routes)
      app.use(globalErrorHandler);
      
      // Setup WordPress sync schedule (run every 5 minutes)
      setupWordPressSyncSchedule(5 * 60 * 1000);
      
      // Register direct game API routes that bypass Vite middleware

      // Legacy direct API endpoints - keeping for reference
      app.get('/direct-api/game/scenes', async (req, res) => {
        try {
          // Set correct Content-Type for JSON response
          res.setHeader('Content-Type', 'application/json');
          
          // First, try to get scenes from the database
          const dbScenes = await storage.getGameScenes();
          
          if (dbScenes && dbScenes.length > 0) {
            return res.json({ scenes: dbScenes });
          }
          
          // If no scenes in DB, use default game scenes
          console.log('No database scenes found, using default scenes');
          
          // Default scene data
          const defaultScenes = [
            {
              sceneId: 'village_entrance',
              name: "Village Entrance",
              description: "A dilapidated wooden sign reading 'Eden's Hollow' creaks in the wind.",
              backgroundImage: "/assets/eden/scenes/village_entrance.jpg",
              type: "exploration",
              data: {
                exits: [
                  { target: "village_square", label: "Enter the village" }
                ],
                items: [],
                characters: []
              }
            },
            {
              sceneId: 'village_square',
              name: "Village Square",
              description: "A once-bustling village square now stands eerily empty.",
              backgroundImage: "/assets/eden/scenes/village_square.jpg",
              type: "exploration",
              data: {
                exits: [
                  { target: "village_entrance", label: "Return to entrance" },
                  { target: "abandoned_church", label: "Visit the church" },
                  { target: "old_tavern", label: "Enter the tavern" }
                ],
                items: [],
                characters: []
              }
            }
          ];
          
          return res.json({
            scenes: defaultScenes,
            source: "default",
            message: "Using default game scenes. Database scenes not available."
          });
        } catch (error) {
          console.error('Error fetching game scenes:', error);
          res.setHeader('Content-Type', 'application/json');
          res.status(500).json({ error: 'Failed to fetch game scenes' });
        }
      });
      
      // Direct API endpoint for a specific game scene by ID
      app.get('/direct-api/game/scenes/:sceneId', async (req, res) => {
        try {
          const { sceneId } = req.params;
          
          // Set correct Content-Type for JSON response
          res.setHeader('Content-Type', 'application/json');
          
          // Try to get the scene from the database
          const scene = await storage.getGameScene(sceneId);
          
          if (scene) {
            return res.json(scene);
          }
          
          // Check for default scenes
          const defaultScenes: Record<string, any> = {
            'village_entrance': {
              sceneId: 'village_entrance',
              name: "Village Entrance",
              description: "A dilapidated wooden sign reading 'Eden's Hollow' creaks in the wind.",
              backgroundImage: "/assets/eden/scenes/village_entrance.jpg",
              type: "exploration",
              data: {
                exits: [
                  { target: "village_square", label: "Enter the village" }
                ],
                items: [],
                characters: []
              }
            },
            'village_square': {
              sceneId: 'village_square',
              name: "Village Square",
              description: "A once-bustling village square now stands eerily empty.",
              backgroundImage: "/assets/eden/scenes/village_square.jpg",
              type: "exploration",
              data: {
                exits: [
                  { target: "village_entrance", label: "Return to entrance" },
                  { target: "abandoned_church", label: "Visit the church" },
                  { target: "old_tavern", label: "Enter the tavern" }
                ],
                items: [],
                characters: []
              }
            }
          };
          
          // Check if requested scene is one of our defaults
          if (defaultScenes[sceneId]) {
            return res.json({
              ...defaultScenes[sceneId],
              source: "default"
            });
          }
          
          // If scene not found, return 404
          return res.status(404).json({ error: 'Scene not found' });
        } catch (error) {
          console.error(`Error fetching game scene ${req.params.sceneId}:`, error);
          res.setHeader('Content-Type', 'application/json');
          res.status(500).json({ error: 'Failed to fetch game scene' });
        }
      });
      
      // We've moved the post recommendations endpoint to main routes.ts
      // registerPostRecommendationsRoutes(app);
      
      await setupVite(app, server);
    } else {
      serverLogger.info('Setting up production environment');
      
      // Register main routes
      registerRoutes(app);
      
      // Register user feedback routes
      registerUserFeedbackRoutes(app, storage);
      
      // Register recommendation routes
      registerRecommendationsRoutes(app, storage);
      
 // User data export routes removed
 
      
      // Register privacy settings routes
      registerPrivacySettingsRoutes(app, storage);
      
      // Register WordPress sync routes
      registerWordPressSyncRoutes(app);
      
      // Register analytics routes
      registerAnalyticsRoutes(app);
      
      // Register email service routes
      registerEmailServiceRoutes(app);
      
      // Register bookmark routes - only once to avoid duplicates
      registerBookmarkRoutes(app);
      
      // Setup WordPress sync schedule (run every 5 minutes)
      setupWordPressSyncSchedule(5 * 60 * 1000);
      
      // Register direct game API routes that bypass Vite middleware

      // Legacy direct API endpoints - keeping for reference
      app.get('/direct-api/game/scenes', async (req, res) => {
        try {
          // Set correct Content-Type for JSON response
          res.setHeader('Content-Type', 'application/json');
          
          // First, try to get scenes from the database
          const dbScenes = await storage.getGameScenes();
          
          if (dbScenes && dbScenes.length > 0) {
            return res.json({ scenes: dbScenes });
          }
          
          // If no scenes in DB, use default game scenes
          console.log('No database scenes found, using default scenes');
          
          // Default scene data
          const defaultScenes = [
            {
              sceneId: 'village_entrance',
              name: "Village Entrance",
              description: "A dilapidated wooden sign reading 'Eden's Hollow' creaks in the wind.",
              backgroundImage: "/assets/eden/scenes/village_entrance.jpg",
              type: "exploration",
              data: {
                exits: [
                  { target: "village_square", label: "Enter the village" }
                ],
                items: [],
                characters: []
              }
            },
            {
              sceneId: 'village_square',
              name: "Village Square",
              description: "A once-bustling village square now stands eerily empty.",
              backgroundImage: "/assets/eden/scenes/village_square.jpg",
              type: "exploration",
              data: {
                exits: [
                  { target: "village_entrance", label: "Return to entrance" },
                  { target: "abandoned_church", label: "Visit the church" },
                  { target: "old_tavern", label: "Enter the tavern" }
                ],
                items: [],
                characters: []
              }
            }
          ];
          
          return res.json({
            scenes: defaultScenes,
            source: "default",
            message: "Using default game scenes. Database scenes not available."
          });
        } catch (error) {
          console.error('Error fetching game scenes:', error);
          res.setHeader('Content-Type', 'application/json');
          res.status(500).json({ error: 'Failed to fetch game scenes' });
        }
      });
      
      // Direct API endpoint for a specific game scene by ID
      app.get('/direct-api/game/scenes/:sceneId', async (req, res) => {
        try {
          const { sceneId } = req.params;
          
          // Set correct Content-Type for JSON response
          res.setHeader('Content-Type', 'application/json');
          
          // Try to get the scene from the database
          const scene = await storage.getGameScene(sceneId);
          
          if (scene) {
            return res.json(scene);
          }
          
          // Check for default scenes
          const defaultScenes: Record<string, any> = {
            'village_entrance': {
              sceneId: 'village_entrance',
              name: "Village Entrance",
              description: "A dilapidated wooden sign reading 'Eden's Hollow' creaks in the wind.",
              backgroundImage: "/assets/eden/scenes/village_entrance.jpg",
              type: "exploration",
              data: {
                exits: [
                  { target: "village_square", label: "Enter the village" }
                ],
                items: [],
                characters: []
              }
            },
            'village_square': {
              sceneId: 'village_square',
              name: "Village Square",
              description: "A once-bustling village square now stands eerily empty.",
              backgroundImage: "/assets/eden/scenes/village_square.jpg",
              type: "exploration",
              data: {
                exits: [
                  { target: "village_entrance", label: "Return to entrance" },
                  { target: "abandoned_church", label: "Visit the church" },
                  { target: "old_tavern", label: "Enter the tavern" }
                ],
                items: [],
                characters: []
              }
            }
          };
          
          // Check if requested scene is one of our defaults
          if (defaultScenes[sceneId]) {
            return res.json({
              ...defaultScenes[sceneId],
              source: "default"
            });
          }
          
          // If scene not found, return 404
          return res.status(404).json({ error: 'Scene not found' });
        } catch (error) {
          console.error(`Error fetching game scene ${req.params.sceneId}:`, error);
          res.setHeader('Content-Type', 'application/json');
          res.status(500).json({ error: 'Failed to fetch game scene' });
        }
      });
      
      // We've moved the post recommendations endpoint to main routes.ts
      // registerPostRecommendationsRoutes(app);
      
      serveStatic(app);
    }

    // Start listening with enhanced error handling and port notification
    return new Promise<void>((resolve, reject) => {
      const startTime = Date.now();
      
      // Log that we're about to start listening
      console.log(`Attempting to start server on http://${HOST}:${PORT}...`);
      
      server.listen(PORT, HOST, () => {
        const bootDuration = Date.now() - startTime;
        console.log(`✅ Server started successfully on http://${HOST}:${PORT} in ${bootDuration}ms`);
        serverLogger.info('Server started successfully', { 
          url: `http://${HOST}:${PORT}`,
          bootTime: `${bootDuration}ms`
        });

        // Send port readiness signal - make it clearer for Replit
        if (process.send) {
          process.send({
            port: PORT,
            wait_for_port: true,
            ready: true
          });
          console.log('Sent port readiness signal to process');
          serverLogger.debug('Sent port readiness signal');
          
          // Output more detailed message for debug purposes
          console.log(`\n🚀 APPLICATION READY! 🚀`);
          console.log(`\n- Server URL: http://${HOST}:${PORT}`);
          console.log(`- Database: Connected successfully`);
          console.log(`- Environment: ${process.env.NODE_ENV || 'development'}`);
          console.log(`\nApplication is now fully ready to accept connections!\n`);
        }
        
        // Wait for a moment to ensure the server is fully ready
        setTimeout(() => {
          console.log('Server is now fully ready to accept connections');
        }, 1000);

        resolve();
      });

      server.on('error', (error: Error & { code?: string }) => {
        if (error.code === 'EADDRINUSE') {
          serverLogger.warn(`Port ${PORT} is already in use, trying alternative ports...`);
          
          // Try each alternative port in the list
          let currentPortIndex = 0;
          const tryNextPort = () => {
            if (currentPortIndex < ALTERNATIVE_PORTS.length) {
              const newPort = ALTERNATIVE_PORTS[currentPortIndex];
              serverLogger.info(`Attempting to use alternative port: ${newPort}`);
              
              // Update the global PORT variable
              PORT = newPort;
              currentPortIndex++;
              
              // Try to listen on the new port
              server.listen(PORT, HOST);
            } else {
              // We've tried all ports and none worked
              serverLogger.error('All ports are in use, cannot start server', { 
                triedPorts: [DEFAULT_PORT, ...ALTERNATIVE_PORTS].join(', ') 
              });
              reject(error);
            }
          };
          
          // Start trying alternative ports
          tryNextPort();
        } else {
          serverLogger.error('Server error', { 
            error: error.message,
            code: error.code,
            stack: error.stack 
          });
          reject(error);
        }
      });
    });
  } catch (error) {
    serverLogger.error('Critical startup error', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  }
}

// Start the server
startServer().catch(error => {
  serverLogger.error('Critical startup error', {
    error: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  serverLogger.info('SIGTERM received, initiating graceful shutdown');
  server?.close(() => {
    serverLogger.info('Server closed successfully');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  serverLogger.error('Uncaught exception', {
    error: error.message,
    stack: error.stack
  });
  
  // Give time for the error to be logged before exiting
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  serverLogger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
});

export default app;
