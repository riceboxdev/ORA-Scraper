
import { PredictionServiceClient, helpers } from '@google-cloud/aiplatform';
import { config } from '../config.js';
import axios from 'axios';

// Multimodal Embedding Model
const MODEL_ID = 'multimodalembedding@001';
const LOCATION = 'us-central1'; // Common location for Vertex AI

const client = new PredictionServiceClient({
    apiEndpoint: `${LOCATION}-aiplatform.googleapis.com`,
});

export const embeddingService = {
    /**
     * Generate multimodal embeddings for a post
     * Input can be text, image (Buffer or URL), or both.
     */
    async generateEmbedding(text?: string, image?: Buffer | string): Promise<number[] | null> {
        const project = config.firebaseProjectId;
        const endpoint = `projects/${project}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}`;

        let imageBuffer: Buffer | undefined;

        if (image instanceof Buffer) {
            imageBuffer = image;
        } else if (typeof image === 'string') {
            try {
                const response = await axios.get(image, { responseType: 'arraybuffer' });
                imageBuffer = Buffer.from(response.data);
            } catch (error) {
                console.error(`[Embedding] Failed to fetch image from URL: ${image}`, error);
            }
        }

        const instance: any = {};
        if (text) {
            instance.text = text;
        }
        if (imageBuffer) {
            instance.image = {
                bytesBase64Encoded: imageBuffer.toString('base64')
            };
        }

        if (!text && !imageBuffer) {
            return null;
        }

        const instances = [helpers.toValue(instance)];
        const parameters = helpers.toValue({});

        try {
            const [response] = await client.predict({
                endpoint,
                instances,
                parameters,
            });

            if (!response.predictions || response.predictions.length === 0) {
                return null;
            }

            // The prediction result for multimodalembedding@001 usually contains
            // imageEmbedding and textEmbedding. We want a unified vector.
            // Documentation states that they are in the same space.
            // If both are present, we might want to average or pick one.
            // Usually, these models return 'textEmbedding' and 'imageEmbedding'
            const prediction: any = helpers.fromValue(response.predictions[0] as any);

            // If we have both, the model usually joins them or returns individual ones.
            // For discovery, we'll try to get the 'imageEmbedding' first, then 'textEmbedding'.
            const vector = prediction.imageEmbedding || prediction.textEmbedding;

            return vector || null;
        } catch (error) {
            console.error('[Embedding] Vertex AI prediction failed:', error);
            return null;
        }
    }
};
