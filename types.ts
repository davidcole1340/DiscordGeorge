export type Station = {
  id: string;
  sortName: string;
  brandName: string;
  highQualityStreamUrl: string;
};

export type OnAir = {
  id: string;
  nowPlaying: OnAirNowPlaying[];
  onAir: OnAirOnAir[];
  source: string;
};

type OnAirNowPlaying = {
  title: string;
  status: string;
  imageUrl: string;
  duration: string;
  artist: string;
};

type OnAirOnAir = OnAirNowPlaying & {
  startTime: string;
  endTime: string;
  showId: string;
  displayTime: string;
  thumbnailUrl: string;
};