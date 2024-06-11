export const StartAudioToVideoSession = async (faceId: string, isJPG: Boolean, syncAudio: Boolean) => {
    const metadata = {
      faceId: faceId,
      isJPG: isJPG,
      apiKey: process.env.NEXT_PUBLIC_SIMLI_API_KEY,
      syncAudio: syncAudio,
    };
  
    const response = await fetch(
      'https://api.simli.ai/startAudioToVideoSession',
      {
        method: 'POST',
        body: JSON.stringify(metadata),
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  
    return response.json();
  };