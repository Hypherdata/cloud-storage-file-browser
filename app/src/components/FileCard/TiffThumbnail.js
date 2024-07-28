import React, { useState, useEffect } from 'react';
import api from "../../api/storage";

const TiffThumbnail = ({ filePath }) => {
    const [thumbnailUrl, setThumbnailUrl] = useState('');

    useEffect(() => {
        const fetchThumbnail = async () => {
            try {
                const { url } = await api.getSharableUrl(filePath, true)
                const response = await fetch(url);
                if (response.ok) {
                    const blob = await response.blob();
                    const url = URL.createObjectURL(blob);
                    setThumbnailUrl(url);
                } else {
                    console.error('Failed to fetch thumbnail');
                }
            } catch (error) {
                console.error('Error fetching thumbnail:', error);
            }
        };

        fetchThumbnail();

        // Cleanup function to revoke the object URL
        return () => {
            if (thumbnailUrl) {
                URL.revokeObjectURL(thumbnailUrl);
            }
        };
    }, [filePath]);

    return (
        <div>
            {thumbnailUrl ? (
                <img src={thumbnailUrl} alt="TIFF Thumbnail" style={{ width: '200px', height: '200px', objectFit: 'contain' }} />
            ) : (
                <div>Loading thumbnail...</div>
            )}
        </div>
    );
};

export default TiffThumbnail;
