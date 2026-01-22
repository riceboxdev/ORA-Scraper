/**
 * CMS Routes - Content Management System endpoints for ORA
 * Manages posts, users, boards, ideas, and analytics
 */

import { Router, Request, Response } from 'express';
import { db } from '../firebase.js';
import admin from 'firebase-admin';

const router = Router();

// ============================================
// POSTS MANAGEMENT
// ============================================

/**
 * GET /api/cms/posts - List posts with filters
 * Query params: limit, startAfter, status, moderationStatus, authorId, search
 */
router.get('/posts', async (req: Request, res: Response) => {
    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
        const status = req.query.status as string;
        const moderationStatus = req.query.moderationStatus as string;
        const authorId = req.query.authorId as string;
        const startAfter = req.query.startAfter as string;

        let query: admin.firestore.Query = db.collection('userPosts')
            .orderBy('createdAt', 'desc');

        if (status) {
            query = query.where('processingStatus', '==', status);
        }
        if (moderationStatus) {
            query = query.where('moderationStatus', '==', moderationStatus);
        }
        if (authorId) {
            query = query.where('authorId', '==', authorId);
        }

        if (startAfter) {
            const startDoc = await db.collection('userPosts').doc(startAfter).get();
            if (startDoc.exists) {
                query = query.startAfter(startDoc);
            }
        }

        query = query.limit(limit);
        const snapshot = await query.get();

        const posts = await Promise.all(snapshot.docs.map(async doc => {
            const data = doc.data();
            // Fetch author info
            let author = null;
            if (data.authorId) {
                const authorDoc = await db.collection('userProfiles').doc(data.authorId).get();
                if (authorDoc.exists) {
                    const authorData = authorDoc.data();
                    author = {
                        id: authorDoc.id,
                        username: authorData?.username,
                        displayName: authorData?.displayName,
                        avatarUrl: authorData?.avatarUrl,
                    };
                }
            }
            return {
                id: doc.id,
                ...data,
                author,
                createdAt: data.createdAt?.toDate?.() || data.createdAt,
            };
        }));

        res.json({
            posts,
            hasMore: snapshot.docs.length === limit,
            lastId: snapshot.docs[snapshot.docs.length - 1]?.id,
        });
    } catch (error) {
        console.error('Error fetching posts:', error);
        res.status(500).json({ error: 'Failed to fetch posts' });
    }
});

/**
 * GET /api/cms/posts/:id - Get single post with full details
 */
router.get('/posts/:id', async (req: Request, res: Response) => {
    try {
        const doc = await db.collection('userPosts').doc(req.params.id).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const data = doc.data()!;

        // Fetch author info
        let author = null;
        if (data.authorId) {
            const authorDoc = await db.collection('userProfiles').doc(data.authorId).get();
            if (authorDoc.exists) {
                author = { id: authorDoc.id, ...authorDoc.data() };
            }
        }

        res.json({
            id: doc.id,
            ...data,
            author,
            createdAt: data.createdAt?.toDate?.() || data.createdAt,
        });
    } catch (error) {
        console.error('Error fetching post:', error);
        res.status(500).json({ error: 'Failed to fetch post' });
    }
});

/**
 * PUT /api/cms/posts/:id - Update post
 */
router.put('/posts/:id', async (req: Request, res: Response) => {
    try {
        const { description, tags, moderationStatus, moderationFlags } = req.body;
        const updates: Record<string, unknown> = {};

        if (description !== undefined) updates.description = description;
        if (tags !== undefined) updates.tags = tags;
        if (moderationStatus !== undefined) updates.moderationStatus = moderationStatus;
        if (moderationFlags !== undefined) updates.moderationFlags = moderationFlags;

        await db.collection('userPosts').doc(req.params.id).update(updates);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating post:', error);
        res.status(500).json({ error: 'Failed to update post' });
    }
});

/**
 * POST /api/cms/posts/:id/moderate - Moderate a post
 */
router.post('/posts/:id/moderate', async (req: Request, res: Response) => {
    try {
        const { action, reason } = req.body; // action: approve, flag, reject
        const validActions = ['approve', 'flag', 'reject'];

        if (!validActions.includes(action)) {
            return res.status(400).json({ error: 'Invalid moderation action' });
        }

        const statusMap: Record<string, string> = {
            approve: 'approved',
            flag: 'flagged',
            reject: 'rejected',
        };

        const updates: Record<string, unknown> = {
            moderationStatus: statusMap[action],
            moderatedAt: admin.firestore.FieldValue.serverTimestamp(),
            moderatedBy: req.user?.uid,
        };

        if (reason) {
            updates.moderationReason = reason;
        }

        await db.collection('userPosts').doc(req.params.id).update(updates);
        res.json({ success: true, status: statusMap[action] });
    } catch (error) {
        console.error('Error moderating post:', error);
        res.status(500).json({ error: 'Failed to moderate post' });
    }
});

/**
 * DELETE /api/cms/posts/:id - Delete post and related data
 */
router.delete('/posts/:id', async (req: Request, res: Response) => {
    try {
        const postId = req.params.id;
        const batch = db.batch();

        // Delete the post
        batch.delete(db.collection('userPosts').doc(postId));

        // Delete board_posts referencing this post
        const boardPosts = await db.collection('board_posts')
            .where('postId', '==', postId)
            .get();
        boardPosts.docs.forEach(doc => batch.delete(doc.ref));

        // Delete engagements for this post
        const engagements = await db.collection('engagements')
            .where('postId', '==', postId)
            .get();
        engagements.docs.forEach(doc => batch.delete(doc.ref));

        // Delete comments for this post
        const comments = await db.collection('comments')
            .where('postId', '==', postId)
            .get();
        comments.docs.forEach(doc => batch.delete(doc.ref));

        await batch.commit();
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting post:', error);
        res.status(500).json({ error: 'Failed to delete post' });
    }
});

/**
 * POST /api/cms/posts/bulk/moderate - Moderate multiple posts
 */
router.post('/posts/bulk/moderate', async (req: Request, res: Response) => {
    try {
        const { ids, action, reason } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'Post IDs are required' });
        }

        const statusMap: Record<string, string> = {
            approve: 'approved',
            flag: 'flagged',
            reject: 'rejected',
        };

        const status = statusMap[action];
        if (!status) return res.status(400).json({ error: 'Invalid action' });

        const batch = db.batch();
        const updatedAt = admin.firestore.FieldValue.serverTimestamp();

        ids.forEach(id => {
            const ref = db.collection('userPosts').doc(id);
            batch.update(ref, {
                moderationStatus: status,
                moderatedAt: updatedAt,
                moderatedBy: req.user?.uid,
                ...(reason ? { moderationReason: reason } : {})
            });
        });

        await batch.commit();
        res.json({ success: true, count: ids.length });
    } catch (error) {
        console.error('Error bulk moderating posts:', error);
        res.status(500).json({ error: 'Failed to bulk moderate posts' });
    }
});

/**
 * POST /api/cms/posts/bulk/delete - Delete multiple posts
 */
router.post('/posts/bulk/delete', async (req: Request, res: Response) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'Post IDs are required' });
        }

        // We'll process in chunks of 500 (Firestore limit)
        const chunks = [];
        for (let i = 0; i < ids.length; i += 500) {
            chunks.push(ids.slice(i, i + 500));
        }

        for (const chunk of chunks) {
            const batch = db.batch();
            for (const id of chunk) {
                batch.delete(db.collection('userPosts').doc(id));
                // Note: In a real prod environment, we would also clear related data
                // but for bulk delete we focus on the primary records first
            }
            await batch.commit();
        }

        res.json({ success: true, count: ids.length });
    } catch (error) {
        console.error('Error bulk deleting posts:', error);
        res.status(500).json({ error: 'Failed to bulk delete posts' });
    }
});

// ============================================
// USERS MANAGEMENT
// ============================================

/**
 * GET /api/cms/users - List users with search
 */
router.get('/users', async (req: Request, res: Response) => {
    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
        const search = req.query.search as string;
        const startAfter = req.query.startAfter as string;

        let query: admin.firestore.Query = db.collection('userProfiles');

        // If no search, we use ordering. If we use createdAt, we might miss users without that field.
        // We'll try to order by createdAt but if the count is suspiciously low, we might need a different approach.
        // For now, let's just make it simpler: order by document ID if createdAt is missing or as a fallback.
        query = query.orderBy('createdAt', 'desc');

        if (startAfter) {
            const startDoc = await db.collection('userProfiles').doc(startAfter).get();
            if (startDoc.exists) {
                query = query.startAfter(startDoc);
            }
        }

        query = query.limit(limit);
        let snapshot = await query.get();

        // Fallback: If we got nothing and there's no search/filters, try without ordering
        if (snapshot.empty && !search && !startAfter) {
            snapshot = await db.collection('userProfiles').limit(limit).get();
        }

        let users = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate?.() || doc.data().createdAt,
        }));

        // Client-side search filter (Firestore doesn't support text search)
        if (search) {
            const searchLower = search.toLowerCase();
            users = users.filter(user =>
                (user as any).username?.toLowerCase().includes(searchLower) ||
                (user as any).displayName?.toLowerCase().includes(searchLower) ||
                (user as any).email?.toLowerCase().includes(searchLower)
            );
        }

        res.json({
            users,
            hasMore: snapshot.docs.length === limit,
            lastId: snapshot.docs[snapshot.docs.length - 1]?.id,
        });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

/**
 * GET /api/cms/users/:id - Get user with stats
 */
router.get('/users/:id', async (req: Request, res: Response) => {
    try {
        const doc = await db.collection('userProfiles').doc(req.params.id).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = doc.data()!;

        // Get post count
        const postsSnapshot = await db.collection('userPosts')
            .where('authorId', '==', req.params.id)
            .count()
            .get();

        // Get boards count
        const boardsSnapshot = await db.collection('boards')
            .where('userId', '==', req.params.id)
            .count()
            .get();

        res.json({
            id: doc.id,
            ...userData,
            createdAt: userData.createdAt?.toDate?.() || userData.createdAt,
            stats: {
                postCount: postsSnapshot.data().count,
                boardCount: boardsSnapshot.data().count,
            },
        });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

/**
 * PUT /api/cms/users/:id - Update user (ban, unban, etc.)
 */
router.put('/users/:id', async (req: Request, res: Response) => {
    try {
        const { banned, banReason, isAdmin } = req.body;
        const updates: Record<string, unknown> = {};

        if (banned !== undefined) {
            updates.banned = banned;
            updates.bannedAt = banned ? admin.firestore.FieldValue.serverTimestamp() : null;
            updates.bannedBy = banned ? req.user?.uid : null;
            if (banReason) updates.banReason = banReason;
        }

        if (isAdmin !== undefined) {
            // Set admin claim in Firebase Auth
            await admin.auth().setCustomUserClaims(req.params.id, { admin: isAdmin });
            updates.isAdmin = isAdmin;
        }

        await db.collection('userProfiles').doc(req.params.id).update(updates);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

/**
 * DELETE /api/cms/users/:id - Delete user and their content
 */
router.delete('/users/:id', async (req: Request, res: Response) => {
    try {
        const userId = req.params.id;
        const batch = db.batch();

        // Delete user profile
        batch.delete(db.collection('userProfiles').doc(userId));

        // Delete user's posts
        const posts = await db.collection('userPosts')
            .where('authorId', '==', userId)
            .get();
        posts.docs.forEach(doc => batch.delete(doc.ref));

        // Delete user's boards
        const boards = await db.collection('boards')
            .where('userId', '==', userId)
            .get();
        boards.docs.forEach(doc => batch.delete(doc.ref));

        // Delete user's board_posts
        const boardPosts = await db.collection('board_posts')
            .where('userId', '==', userId)
            .get();
        boardPosts.docs.forEach(doc => batch.delete(doc.ref));

        // Delete user interests
        batch.delete(db.collection('userInterests').doc(userId));

        await batch.commit();

        // Delete Firebase Auth user
        try {
            await admin.auth().deleteUser(userId);
        } catch (authError) {
            console.warn('Could not delete auth user:', authError);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// ============================================
// BOARDS MANAGEMENT
// ============================================

/**
 * GET /api/cms/boards - List all boards
 */
router.get('/boards', async (req: Request, res: Response) => {
    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
        const startAfter = req.query.startAfter as string;

        let query: admin.firestore.Query = db.collection('boards')
            .orderBy('createdAt', 'desc');

        if (startAfter) {
            const startDoc = await db.collection('boards').doc(startAfter).get();
            if (startDoc.exists) {
                query = query.startAfter(startDoc);
            }
        }

        query = query.limit(limit);
        const snapshot = await query.get();

        const boards = await Promise.all(snapshot.docs.map(async doc => {
            const data = doc.data();
            // Fetch owner info
            let owner = null;
            if (data.userId) {
                const ownerDoc = await db.collection('userProfiles').doc(data.userId).get();
                if (ownerDoc.exists) {
                    const ownerData = ownerDoc.data();
                    owner = {
                        id: ownerDoc.id,
                        username: ownerData?.username,
                        displayName: ownerData?.displayName,
                    };
                }
            }
            return {
                id: doc.id,
                ...data,
                owner,
                createdAt: data.createdAt?.toDate?.() || data.createdAt,
            };
        }));

        res.json({
            boards,
            hasMore: snapshot.docs.length === limit,
            lastId: snapshot.docs[snapshot.docs.length - 1]?.id,
        });
    } catch (error) {
        console.error('Error fetching boards:', error);
        res.status(500).json({ error: 'Failed to fetch boards' });
    }
});

/**
 * GET /api/cms/boards/:id - Get board with posts preview
 */
router.get('/boards/:id', async (req: Request, res: Response) => {
    try {
        const doc = await db.collection('boards').doc(req.params.id).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Board not found' });
        }

        const data = doc.data()!;

        // Fetch owner info
        let owner = null;
        if (data.userId) {
            const ownerDoc = await db.collection('userProfiles').doc(data.userId).get();
            if (ownerDoc.exists) {
                owner = { id: ownerDoc.id, ...ownerDoc.data() };
            }
        }

        // Fetch preview posts
        const boardPostsSnapshot = await db.collection('board_posts')
            .where('boardId', '==', req.params.id)
            .orderBy('createdAt', 'desc')
            .limit(12)
            .get();

        const postIds = boardPostsSnapshot.docs.map(d => d.data().postId);
        const posts = [];
        for (const postId of postIds) {
            const postDoc = await db.collection('userPosts').doc(postId).get();
            if (postDoc.exists) {
                posts.push({ id: postDoc.id, ...postDoc.data() });
            }
        }

        res.json({
            id: doc.id,
            ...data,
            owner,
            previewPosts: posts,
            createdAt: data.createdAt?.toDate?.() || data.createdAt,
        });
    } catch (error) {
        console.error('Error fetching board:', error);
        res.status(500).json({ error: 'Failed to fetch board' });
    }
});

/**
 * DELETE /api/cms/boards/:id - Delete board
 */
router.delete('/boards/:id', async (req: Request, res: Response) => {
    try {
        const boardId = req.params.id;
        const batch = db.batch();

        // Delete the board
        batch.delete(db.collection('boards').doc(boardId));

        // Delete all board_posts
        const boardPosts = await db.collection('board_posts')
            .where('boardId', '==', boardId)
            .get();
        boardPosts.docs.forEach(doc => batch.delete(doc.ref));

        await batch.commit();
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting board:', error);
        res.status(500).json({ error: 'Failed to delete board' });
    }
});

// ============================================
// IDEAS (CATEGORIES) MANAGEMENT
// ============================================
// IDEA SUGGESTIONS MANAGEMENT
// ============================================

/**
 * GET /api/cms/ideas/suggestions - List pending suggestions
 */
router.get('/ideas/suggestions', async (req: Request, res: Response) => {
    try {
        const snapshot = await db.collection('ideaSuggestions')
            .where('status', '==', 'pending')
            .orderBy('suggestedAt', 'desc')
            .get();

        const suggestions = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        }));

        res.json({ suggestions });
    } catch (error: any) {
        console.error('Error fetching suggestions:', error);
        res.status(500).json({
            error: 'Failed to fetch suggestions',
            details: error.message,
            code: error.code
        });
    }
});

/**
 * POST /api/cms/ideas/suggestions/:id/approve - Approve suggestion (create idea)
 */
router.post('/ideas/suggestions/:id/approve', async (req: Request, res: Response) => {
    try {
        const suggestionId = req.params.id;
        const suggestionDoc = await db.collection('ideaSuggestions').doc(suggestionId).get();

        if (!suggestionDoc.exists) {
            return res.status(404).json({ error: 'Suggestion not found' });
        }

        const suggestion = suggestionDoc.data()!;
        const batch = db.batch();

        // 1. Create the new Category (Idea)
        const newIdeaRef = db.collection('categories').doc();
        batch.set(newIdeaRef, {
            name: suggestion.name,
            slug: suggestion.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
            description: suggestion.description,
            color: suggestion.suggestedColor,
            iconName: suggestion.suggestedIcon,
            postCount: 0,
            thumbnailUrls: suggestion.thumbnailUrls || [],
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            source: 'suggestion-approval',
            originalSuggestionId: suggestionId
        });

        // 2. Update status of suggestion to approved
        batch.update(db.collection('ideaSuggestions').doc(suggestionId), {
            status: 'approved',
            approvedAt: admin.firestore.FieldValue.serverTimestamp(),
            approvedBy: req.user?.uid,
            createdCategoryId: newIdeaRef.id
        });

        await batch.commit();

        res.json({
            success: true,
            ideaId: newIdeaRef.id,
            message: 'Suggestion approved and category created'
        });

    } catch (error) {
        console.error('Error approving suggestion:', error);
        res.status(500).json({ error: 'Failed to approve suggestion' });
    }
});

/**
 * POST /api/cms/ideas/suggestions/:id/reject - Reject suggestion
 */
router.post('/ideas/suggestions/:id/reject', async (req: Request, res: Response) => {
    try {
        await db.collection('ideaSuggestions').doc(req.params.id).update({
            status: 'rejected',
            rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
            rejectedBy: req.user?.uid
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error rejecting suggestion:', error);
        res.status(500).json({ error: 'Failed to reject suggestion' });
    }
});

// ============================================

/**
 * GET /api/cms/ideas - List all ideas
 */
router.get('/ideas', async (req: Request, res: Response) => {
    try {
        const snapshot = await db.collection('categories')
            .orderBy('postCount', 'desc')
            .get();

        const ideas = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        }));

        res.json({ ideas });
    } catch (error) {
        console.error('Error fetching ideas:', error);
        res.status(500).json({ error: 'Failed to fetch ideas' });
    }
});

/**
 * GET /api/cms/ideas/:id - Get idea with sample posts
 */
router.get('/ideas/:id', async (req: Request, res: Response) => {
    try {
        const doc = await db.collection('categories').doc(req.params.id).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Idea not found' });
        }

        const data = doc.data()!;

        // Fetch sample posts with high affinity to this idea
        const postsSnapshot = await db.collection('userPosts')
            .where(`interestAffinities.${req.params.id}`, '>', 0.5)
            .orderBy(`interestAffinities.${req.params.id}`, 'desc')
            .limit(12)
            .get();

        const samplePosts = postsSnapshot.docs.map(d => ({
            id: d.id,
            ...d.data(),
        }));

        res.json({
            id: doc.id,
            ...data,
            samplePosts,
        });
    } catch (error) {
        console.error('Error fetching idea:', error);
        res.status(500).json({ error: 'Failed to fetch idea' });
    }
});

/**
 * POST /api/cms/ideas - Create new idea
 */
router.post('/ideas', async (req: Request, res: Response) => {
    try {
        const { name, slug, description, color, iconName } = req.body;

        if (!name || !slug) {
            return res.status(400).json({ error: 'Name and slug are required' });
        }

        const idea = {
            name,
            slug,
            description: description || null,
            color: color || null,
            iconName: iconName || null,
            postCount: 0,
            thumbnailUrls: [],
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        const docRef = await db.collection('categories').add(idea);
        res.json({ id: docRef.id, ...idea });
    } catch (error) {
        console.error('Error creating idea:', error);
        res.status(500).json({ error: 'Failed to create idea' });
    }
});

/**
 * PUT /api/cms/ideas/:id - Update idea
 */
router.put('/ideas/:id', async (req: Request, res: Response) => {
    try {
        const { name, slug, description, color, iconName } = req.body;
        const updates: Record<string, unknown> = {};

        if (name !== undefined) updates.name = name;
        if (slug !== undefined) updates.slug = slug;
        if (description !== undefined) updates.description = description;
        if (color !== undefined) updates.color = color;
        if (iconName !== undefined) updates.iconName = iconName;

        await db.collection('categories').doc(req.params.id).update(updates);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating idea:', error);
        res.status(500).json({ error: 'Failed to update idea' });
    }
});

/**
 * DELETE /api/cms/ideas/:id - Delete idea
 */
router.delete('/ideas/:id', async (req: Request, res: Response) => {
    try {
        await db.collection('categories').doc(req.params.id).delete();
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting idea:', error);
        res.status(500).json({ error: 'Failed to delete idea' });
    }
});

// ============================================
// ============================================
// ANALYTICS
// ============================================

/**
 * GET /api/cms/analytics/overview - Platform overview stats
 */
router.get('/analytics/overview', async (req: Request, res: Response) => {
    try {
        // Get counts using Firestore aggregation
        const [usersCount, postsCount, boardsCount, ideasCount] = await Promise.all([
            db.collection('userProfiles').count().get(),
            db.collection('userPosts').count().get(),
            db.collection('boards').count().get(),
            db.collection('categories').count().get(),
        ]);

        // Get posts by status
        const [pendingCount, completedCount, failedCount] = await Promise.all([
            db.collection('userPosts').where('processingStatus', '==', 'pending').count().get(),
            db.collection('userPosts').where('processingStatus', '==', 'completed').count().get(),
            db.collection('userPosts').where('processingStatus', '==', 'failed').count().get(),
        ]);

        // Get moderation queue
        const [flaggedCount, awaitingModerationCount] = await Promise.all([
            db.collection('userPosts').where('moderationStatus', '==', 'flagged').count().get(),
            db.collection('userPosts').where('moderationStatus', '==', 'pending').count().get(),
        ]);

        res.json({
            totals: {
                users: usersCount.data().count,
                posts: postsCount.data().count,
                boards: boardsCount.data().count,
                ideas: ideasCount.data().count,
            },
            processing: {
                pending: pendingCount.data().count,
                completed: completedCount.data().count,
                failed: failedCount.data().count,
            },
            moderation: {
                flagged: flaggedCount.data().count,
                awaitingModeration: awaitingModerationCount.data().count,
            },
        });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

/**
 * GET /api/cms/analytics/growth - Growth metrics over time
 */
router.get('/analytics/growth', async (req: Request, res: Response) => {
    try {
        const days = parseInt(req.query.days as string) || 30;
        const now = new Date();
        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - days);

        // Get recent users
        const usersSnapshot = await db.collection('userProfiles')
            .where('createdAt', '>=', startDate)
            .orderBy('createdAt', 'asc')
            .get();

        // Get recent posts
        const postsSnapshot = await db.collection('userPosts')
            .where('createdAt', '>=', startDate)
            .orderBy('createdAt', 'asc')
            .get();

        // Aggregate by day
        const usersByDay: Record<string, number> = {};
        const postsByDay: Record<string, number> = {};

        usersSnapshot.docs.forEach(doc => {
            const date = doc.data().createdAt?.toDate?.() || new Date(doc.data().createdAt);
            const dayKey = date.toISOString().split('T')[0];
            usersByDay[dayKey] = (usersByDay[dayKey] || 0) + 1;
        });

        postsSnapshot.docs.forEach(doc => {
            const date = doc.data().createdAt?.toDate?.() || new Date(doc.data().createdAt);
            const dayKey = date.toISOString().split('T')[0];
            postsByDay[dayKey] = (postsByDay[dayKey] || 0) + 1;
        });

        // Fill in missing days
        const result = [];
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dayKey = date.toISOString().split('T')[0];
            result.push({
                date: dayKey,
                users: usersByDay[dayKey] || 0,
                posts: postsByDay[dayKey] || 0,
            });
        }

        res.json({ growth: result });
    } catch (error) {
        console.error('Error fetching growth analytics:', error);
        res.status(500).json({ error: 'Failed to fetch growth analytics' });
    }
});

export default router;
