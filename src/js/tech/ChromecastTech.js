var ChromecastSessionManager = require('../chromecast/ChromecastSessionManager'),
    ChromecastTechUI = require('./ChromecastTechUI'),
    SESSION_TIMEOUT = 10 * 1000, // milliseconds
    ChromecastTech;

/**
 * @module ChromecastTech
 */

/**
 * The Video.js Tech class is the base class for classes that provide media playback
 * technology implementations to Video.js such as HTML5, Flash and HLS.
 *
 * @external Tech
 * @see {@link http://docs.videojs.com/Tech.html|Tech}
 */

/** @lends ChromecastTech.prototype */
ChromecastTech = {

   /**
    * Implements Video.js playback {@link http://docs.videojs.com/tutorial-tech_.html|Tech}
    * for {@link https://developers.google.com/cast/|Google's Chromecast}.
    *
    * @constructs ChromecastTech
    * @extends external:Tech
    * @param options {object} The options to use for configuration
    * @see {@link https://developers.google.com/cast/|Google Cast}
    */
   constructor: function(options) {
      var mediaSession,
          textTrackDisplay,
          subclass;

      this._eventListeners = [];
      this.options = options;
      this.videojsPlayer = this.videojs(options.playerId);
      this._chromecastSessionManager = this.videojsPlayer.chromecastSessionManager;

      // We have to initialize the UI here, before calling super.constructor
      // because the constructor calls `createEl`, which references `this._ui`.
      this._ui = new ChromecastTechUI();
      this._ui.updatePoster(this.videojsPlayer.poster());

      // Call the super class' constructor function
      subclass = this.constructor.super_.apply(this, arguments);

      this._remotePlayer = this._chromecastSessionManager.getRemotePlayer();
      this._remotePlayerController = this._chromecastSessionManager.getRemotePlayerController();
      this._listenToPlayerControllerEvents();
      this.on('dispose', this._onDispose.bind(this));

      this._hasPlayedAnyItem = false;
      this._requestTitle = options.requestTitleFn || function() { /* noop */ };
      this._requestSubtitle = options.requestSubtitleFn || function() { /* noop */ };
      this._requestCustomData = options.requestCustomDataFn || function() { /* noop */ };
      this._requestQueueItemChange = options.requestQueueItemChangeFn || function() { /* noop */ };
      this._requestCustomData = options.requestCustomDataFn || function() { /* noop */ };

      this._requestLoadSource = options.requestLoadSourceFn || function(source) {
         return source;
      };
      const loadSource = this._requestLoadSource(options.source);

      // See `currentTime` function
      this._initialStartTime = options.startTime === undefined ? (loadSource.startTime || 0) : options.startTime;

      mediaSession = this._getMediaSession();
      if (mediaSession && mediaSession.media && mediaSession.media.entity === loadSource.entity) {
         this.onLoadSessionSuccess();
      } else {
         this._playSource(options.source);
      }

      this.ready(function() {
         this.setMuted(options.muted);
      }.bind(this));
      this.videojsPlayer.remoteTextTracks().on('change', this._onChangeTrack.bind(this));
      textTrackDisplay = this.videojsPlayer.getChild('TextTrackDisplay');

      if (textTrackDisplay) {
         textTrackDisplay.hide();
      }

      return subclass;
   },

   /**
    * Creates a DOMElement that Video.js displays in its player UI while this Tech is
    * active.
    *
    * @returns {DOMElement}
    * @see {@link http://docs.videojs.com/Tech.html#createEl}
    */
   createEl: function() {
      return this._ui.getDOMElement();
   },

   /**
    * Resumes playback if a media item is paused or restarts an item from its beginning if
    * the item has played and ended.
    *
    * @see {@link http://docs.videojs.com/Player.html#play}
    */
   play: function() {
      if (!this.paused()) {
         return;
      }
      if (this.ended()) {
         // Restart the current item from the beginning
         this._playSource(this.videojsPlayer.currentSource(), 0);
      } else {
         this._remotePlayerController.playOrPause();
      }
   },

   /**
    * Pauses playback if the player is not already paused and if the current media item
    * has not ended yet.
    *
    * @see {@link http://docs.videojs.com/Player.html#pause}
    */
   pause: function() {
      if (!this.paused() && this._remotePlayer.canPause) {
         this._remotePlayerController.playOrPause();
      }
   },

   /**
    * Returns whether or not the player is "paused". Video.js' definition of "paused" is
    * "playback paused" OR "not playing".
    *
    * @returns {boolean} true if playback is paused
    * @see {@link http://docs.videojs.com/Player.html#paused}
    */
   paused: function() {
      return this._remotePlayer.isPaused || this.ended() || this._remotePlayer.playerState === null;
   },

   /**
    * Stores the given source and begins playback, starting at the beginning
    * of the media item.
    *
    * @param source {object} the source to store and play
    * @see {@link http://docs.videojs.com/Player.html#src}
    */
   setSource: function(source) {
      const mediaSession = this._getMediaSession();

      if (source.entity && mediaSession && mediaSession.media && mediaSession.media.entity === source.entity) {
         // Skip setting the source if the `source` argument is the same as what's already
         // been set. This `setSource` function calls `this._playSource` which sends a
         // "load media" request to the Chromecast PlayerController. Because this function
         // may be called multiple times in rapid succession with the same `source`
         // argument, we need to de-duplicate calls with the same `source` argument to
         // prevent overwhelming the Chromecast PlayerController with expensive "load
         // media" requests, which it itself does not de-duplicate.
         return;
      }

      this._playSource(source);
   },

   /**
    * Generate `chrome.cast.media.Track` instance from `trackData`
    *
    * @param trackData {Object}
    * @param trackData.src
    * @param trackData.kind
    * @param trackData.language
    * @param id
    * @returns {chrome.cast.media.Track}
    * @see https://developers.google.com/cast/docs/reference/chrome/chrome.cast.media.Track
    */
   generateTrack: function(trackData, id) {
      var sub = new chrome.cast.media.Track(id, chrome.cast.media.TrackType.TEXT),
          textTrackTypes;

      textTrackTypes = {
         subtitles: chrome.cast.media.TextTrackType.SUBTITLES,
         captions: chrome.cast.media.TextTrackType.CAPTIONS,
         descriptions: chrome.cast.media.TextTrackType.DESCRIPTIONS,
         chapters: chrome.cast.media.TextTrackType.CHAPTERS,
         metadata: chrome.cast.media.TextTrackType.METADATA,
      };

      sub.trackContentId = trackData.src;
      sub.subtype = textTrackTypes[trackData.kind];
      sub.name = trackData.language;
      sub.language = trackData.language;
      return sub;
   },

   /**
    * _onChangeTrack
    * @private
    */
   _onChangeTrack: function() {
      var castSession = cast.framework.CastContext.getInstance().getCurrentSession(),
          media = castSession.getMediaSession(),
          noop = function() { /* noop */ },
          index, subtitles, tracksInfoRequest, i;

      // TODO: investigate the case when we're trying to change track while there's no `media` (yet?)
      if (castSession && media) {
         index = [];
         subtitles = this.videojsPlayer.remoteTextTracks();
         for (i = 0; i < subtitles.length; i++) {
            if (subtitles[i].mode === 'showing') {
               index = [ i ];
            }
         }
         tracksInfoRequest = new chrome.cast.media.EditTracksInfoRequest(index);

         media.editTracksInfo(tracksInfoRequest, noop, noop);
      }
   },

   /**
    * Plays the given source, beginning at an optional starting time.
    *
    * @private
    * @param source {object} the source to play
    * @param [startTime] The time to start playback at, in seconds
    * @see {@link http://docs.videojs.com/Player.html#src}
    */
   _playSource: function(source, startTime) {

      var castSession = this._getCastSession(),
          loadSource = this._requestLoadSource(source),
          mediaInfo = new chrome.cast.media.MediaInfo(loadSource.src, loadSource.type),
          title = this._requestTitle(source),
          subtitle = this._requestSubtitle(source),
          customData = this._requestCustomData(source),
          textTrackJsonTracks = this.videojsPlayer.textTracksJson_,
          request,
          castSessionObj,
          i;

      this.trigger('waiting');
      this._clearSessionTimeout();

      // if more then one source was load, load queue
      if (loadSource.sources) {
         this._queue = loadSource.sources;
         const queueMediaInfo = loadSource.sources.map((queueItem) => {
            const mediaInfoItem = new chrome.cast.media.MediaInfo(queueItem.src, queueItem.type);

            mediaInfoItem.entity = queueItem.entity;

            mediaInfoItem.contentUrl = queueItem.src;
            mediaInfoItem.metadata = new chrome.cast.media.GenericMediaMetadata();
            mediaInfoItem.metadata.title = queueItem.title;
            mediaInfoItem.duration = queueItem.duration;
            mediaInfoItem.metadata.subtitle = queueItem.subtitle;
            mediaInfoItem.streamType = this.videojsPlayer.liveTracker && this.videojsPlayer.liveTracker.isLive()
               ? chrome.cast.media.StreamType.LIVE
               : chrome.cast.media.StreamType.BUFFERED;
            mediaInfoItem.tracks = [];
            mediaInfoItem.activeTrackIds = [];
            return new chrome.cast.media.QueueItem(mediaInfoItem);
         });

         request = new chrome.cast.media.LoadRequest();
         request.startIndex = loadSource.startIndex;
         request.queueData = new chrome.cast.media.QueueData(undefined, undefined, undefined, undefined, queueMediaInfo, loadSource.startIndex, loadSource.startTime);
      } else {
         this._queue = null;
         mediaInfo.entity = loadSource.entity;
         mediaInfo.contentUrl = loadSource.src;
         mediaInfo.contentType = loadSource.type;

         mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
         mediaInfo.metadata.metadataType = chrome.cast.media.MetadataType.GENERIC;
         mediaInfo.metadata.title = title;
         mediaInfo.metadata.subtitle = subtitle;
         mediaInfo.streamType = this.videojsPlayer.liveTracker && this.videojsPlayer.liveTracker.isLive()
            ? chrome.cast.media.StreamType.LIVE
            : chrome.cast.media.StreamType.BUFFERED;
         mediaInfo.tracks = [];
         mediaInfo.activeTrackIds = [];

         for (i = 0; i < textTrackJsonTracks.length; i++) {
            mediaInfo.tracks.push(this.generateTrack(textTrackJsonTracks[i], i));
            if (textTrackJsonTracks[i].mode === 'showing') {
               mediaInfo.activeTrackIds.push(i);
            }
         }

         if (customData) {
            mediaInfo.customData = customData;
         }
         request = new chrome.cast.media.LoadRequest(mediaInfo);
      }

      request.autoplay = true;
      request.currentTime = startTime === undefined ? loadSource.startTime : startTime;
      request.customData = this._requestCustomData();
      if (loadSource.credentials) {
         request.credentials = loadSource.credentials;
         request.credentialsType = loadSource.credentialsType;
      }
      this._isMediaLoading = true;
      this._hasPlayedCurrentItem = false;
      this._ui.updateTitle(title);
      this._ui.updateSubtitle(subtitle);
      castSessionObj = castSession.getSessionObj();
      castSessionObj.loadMedia(request, this.onLoadSessionSuccess.bind(this), this._triggerErrorEvent.bind(this));
   },

   /**
    * onLoadSessionSuccess
    */
   onLoadSessionSuccess: function() {
      if (!this._hasPlayedAnyItem) {
         // `triggerReady` is required here to notify the Video.js player that the
         // Tech has been initialized and is ready.
         this.triggerReady();
      }

      this.trigger('loadstart');
      this.trigger('loadeddata');
      this.trigger('play');
      this.trigger('playing');
      this.videojsPlayer.hasStarted(true);
      this._hasPlayedAnyItem = true;
      this._isMediaLoading = false;
      clearTimeout(this.playStateValidationTimeout);
      this.playStateValidationTimeout = window.setTimeout(this.validatePlayState.bind(this), 1000);
      this._getMediaSession().addUpdateListener(this._onMediaSessionStatusChanged.bind(this));
   },

   /**
    * Validate play state to make sure Chromecast and local player are in sync.
    */
   validatePlayState: function() {
      var textTrackDisplay = this.videojsPlayer.getChild('TextTrackDisplay');

      this._triggerTimeUpdateEvent();
      this._onPlayerStateChanged();
      this._onChangeTrack();

      if (textTrackDisplay) {
         textTrackDisplay.hide();
      }
   },

   /**
    * Manually updates the current time. The playback position will jump to the given time
    * and continue playing if the item was playing when `setCurrentTime` was called, or
    * remain paused if the item was paused.
    *
    * @param time {number} the playback time position to jump to
    * @see {@link http://docs.videojs.com/Tech.html#setCurrentTime}
    */
   setCurrentTime: function(time) {
      var duration = this.duration();

      if (time > duration || !this._remotePlayer.canSeek) {
         return;
      }
      // Seeking to any place within (approximately) 1 second of the end of the item
      // causes the Video.js player to get stuck in a BUFFERING state. To work around
      // this, we only allow seeking to within 1 second of the end of an item.
      this._remotePlayer.currentTime = Math.min(duration - 1, time);
      this._remotePlayerController.seek();
      this._triggerTimeUpdateEvent();
   },

   /**
    * Returns the current playback time position.
    *
    * @returns {number} the current playback time position
    * @see {@link http://docs.videojs.com/Player.html#currentTime}
    */
   currentTime: function() {
      // There is a brief period of time when Video.js has switched to the chromecast
      // Tech, but chromecast has not yet loaded its first media item. During that time,
      // Video.js calls this `currentTime` function to update its player UI. In that
      // period, `this._remotePlayer.currentTime` will be 0 because the media has not
      // loaded yet. To prevent the UI from using a 0 second currentTime, we use the
      // currentTime passed in to the first media item that was provided to the Tech until
      // chromecast plays its first item.
      if (!this._hasPlayedAnyItem) {
         return this._initialStartTime;
      }
      return this._remotePlayer.currentTime;
   },

   /**
    * Returns the duration of the current media item, or `0` if the source is not set or
    * if the duration of the item is not available from the Chromecast API yet.
    *
    * @returns {number} the duration of the current media item
    * @see {@link http://docs.videojs.com/Player.html#duration}
    */
   duration: function() {
      // There is a brief period of time when Video.js has switched to the chromecast
      // Tech, but chromecast has not yet loaded its first media item. During that time,
      // Video.js calls this `duration` function to update its player UI. In that period,
      // `this._remotePlayer.duration` will be 0 because the media has not loaded yet. To
      // prevent the UI from using a 0 second duration, we use the duration passed in to
      // the first media item that was provided to the Tech until chromecast plays its
      // first item.
      if (!this._hasPlayedAnyItem) {
         return this.videojsPlayer.duration();
      }
      return this._remotePlayer.duration;
   },

   /**
    * Returns whether or not the current media item has finished playing. Returns `false`
    * if a media item has not been loaded, has not been played, or has not yet finished
    * playing.
    *
    * @returns {boolean} true if the current media item has finished playing
    * @see {@link http://docs.videojs.com/Player.html#ended}
    */
   ended: function() {
      var mediaSession = this._getMediaSession();

      // Don't check for queues
      // When handling a queue there are moments when mediaSession is null and current item has already finished
      // and the new item is not started loading yet, which would end the session.
      if (this._queue) {
         return false;
      }
      if (!mediaSession && this._hasMediaSessionEnded && !this._isMediaLoading) {
         return true;
      }
      return mediaSession ? (mediaSession.idleReason === chrome.cast.media.IdleReason.FINISHED) : false;
   },

   /**
    * Returns the current volume level setting as a decimal number between `0` and `1`.
    *
    * @returns {number} the current volume level
    * @see {@link http://docs.videojs.com/Player.html#volume}
    */
   volume: function() {
      return this._remotePlayer.volumeLevel;
   },

   /**
    * Sets the current volume level. Volume level is a decimal number between `0` and `1`,
    * where `0` is muted and `1` is the loudest volume level.
    *
    * @param volumeLevel {number}
    * @returns {number} the current volume level
    * @see {@link http://docs.videojs.com/Player.html#volume}
    */
   setVolume: function(volumeLevel) {
      this._remotePlayer.volumeLevel = volumeLevel;
      this._remotePlayerController.setVolumeLevel();
      // This event is triggered by the listener on
      // `RemotePlayerEventType.VOLUME_LEVEL_CHANGED`, but waiting for that event to fire
      // in response to calls to `setVolume` introduces noticeable lag in the updating of
      // the player UI's volume slider bar, which makes user interaction with the volume
      // slider choppy.
      this._triggerVolumeChangeEvent();
   },

   /**
    * Returns whether or not the player is currently muted.
    *
    * @returns {boolean} true if the player is currently muted
    * @see {@link http://docs.videojs.com/Player.html#muted}
    */
   muted: function() {
      return this._remotePlayer.isMuted;
   },

   /**
    * Mutes or un-mutes the player. Does nothing if the player is currently muted and the
    * `isMuted` parameter is true or if the player is not muted and `isMuted` is false.
    *
    * @param isMuted {boolean} whether or not the player should be muted
    * @see {@link http://docs.videojs.com/Html5.html#setMuted} for an example
    */
   setMuted: function(isMuted) {
      if ((this._remotePlayer.isMuted && !isMuted) || (!this._remotePlayer.isMuted && isMuted)) {
         this._remotePlayerController.muteOrUnmute();
      }
   },

   /**
    * Gets the URL to the current poster image.
    *
    * @returns {string} URL to the current poster image or `undefined` if none exists
    * @see {@link http://docs.videojs.com/Player.html#poster}
    */
   poster: function() {
      return this._ui.getPoster();
   },

   /**
    * Sets the URL to the current poster image. The poster image shown in the Chromecast
    * Tech UI view is updated with this new URL.
    *
    * @param poster {string} the URL to the new poster image
    * @see {@link http://docs.videojs.com/Tech.html#setPoster}
    */
   setPoster: function(poster) {
      this._ui.updatePoster(poster);
   },

   /**
    * This function is "required" when implementing {@link external:Tech} and is supposed
    * to return a mock
    * {@link https://developer.mozilla.org/en-US/docs/Web/API/TimeRanges|TimeRanges}
    * object that represents the portions of the current media item that have been
    * buffered. However, the Chromecast API does not currently provide a way to determine
    * how much the media item has buffered, so we always return `undefined`.
    *
    * Returning `undefined` is safe: the player will simply not display the buffer amount
    * indicator in the scrubber UI.
    *
    * @returns {undefined} always returns `undefined`
    * @see {@link http://docs.videojs.com/Player.html#buffered}
    */
   buffered: function() {
      return undefined;
   },

   /**
    * This function is "required" when implementing {@link external:Tech} and is supposed
    * to return a mock
    * {@link https://developer.mozilla.org/en-US/docs/Web/API/TimeRanges|TimeRanges}
    * object that represents the portions of the current media item that has playable
    * content. However, the Chromecast API does not currently provide a way to determine
    * how much the media item has playable content, so we'll just assume the entire video
    * is an available seek target.
    *
    * The risk here lies with live streaming, where there may exist a sliding window of
    * playable content and seeking is only possible within the last X number of minutes,
    * rather than for the entire video.
    *
    * Unfortunately we have no way of detecting when this is the case. Returning anything
    * other than the full range of the video means that we lose the ability to seek during
    * VOD.
    *
    * @returns {TimeRanges} always returns a `TimeRanges` object with one `TimeRange` that
    * starts at `0` and ends at the `duration` of the current media item
    * @see {@link http://docs.videojs.com/Player.html#seekable}
    */
   seekable: function() {
      // TODO Investigate if there's a way to detect if the source is live, so that we can
      // possibly adjust the seekable `TimeRanges` accordingly.
      return this.videojs.createTimeRange(0, this.duration());
   },

   /**
    * Returns whether the native media controls should be shown (`true`) or hidden
    * (`false`). Not applicable to this Tech.
    *
    * @returns {boolean} always returns `false`
    * @see {@link http://docs.videojs.com/Html5.html#controls} for an example
    */
   controls: function() {
      return false;
   },

   /**
    * Returns whether or not the browser should show the player "inline" (non-fullscreen)
    * by default. This function always returns true to tell the browser that non-
    * fullscreen playback is preferred.
    *
    * @returns {boolean} always returns `true`
    * @see {@link http://docs.videojs.com/Html5.html#playsinline} for an example
    */
   playsinline: function() {
      return true;
   },

   /**
    * Returns whether or not fullscreen is supported by this Tech. Always returns `true`
    * because fullscreen is always supported.
    *
    * @returns {boolean} always returns `true`
    * @see {@link http://docs.videojs.com/Html5.html#supportsFullScreen} for an example
    */
   supportsFullScreen: function() {
      return true;
   },

   /**
    * Sets a flag that determines whether or not the media should automatically begin
    * playing on page load. This is not supported because a Chromecast session must be
    * initiated by casting via the casting menu and cannot autoplay.
    *
    * @see {@link http://docs.videojs.com/Html5.html#setAutoplay} for an example
    */
   setAutoplay: function() {
      // Not supported
   },

   /**
    * @returns {number} the chromecast player's playback rate, if available. Otherwise,
    * the return value defaults to `1`.
    */
   playbackRate: function() {
      var mediaSession = this._getMediaSession();

      return mediaSession ? mediaSession.playbackRate : 1;
   },

   /**
    * Does nothing. Changing the playback rate is not supported.
    */
   setPlaybackRate: function() {
      // Not supported
   },

   /**
    * Does nothing. Satisfies calls to the missing preload method.
    */
   preload: function() {
      // Not supported
   },

   /**
    * Causes the Tech to begin loading the current source. `load` is not supported in this
    * ChromecastTech because setting the source on the `Chromecast` automatically causes
    * it to begin loading.
    */
   load: function() {
      // Not supported
   },

   /**
    * Gets the Chromecast equivalent of HTML5 Media Element's `readyState`.
    *
    * @see https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/readyState
    */
   readyState: function() {
      if (this._remotePlayer.playerState === 'IDLE' || this._remotePlayer.playerState === 'BUFFERING') {
         return 0; // HAVE_NOTHING
      }
      return 4;
   },

   /**
    * Wires up event listeners for
    * [RemotePlayerController](https://developers.google.com/cast/docs/reference/chrome/cast.framework.RemotePlayerController)
    * events.
    *
    * @private
    */
   _listenToPlayerControllerEvents: function() {
      var eventTypes = cast.framework.RemotePlayerEventType;


      this._addEventListener(this._remotePlayerController, eventTypes.PLAYER_STATE_CHANGED, this._onPlayerStateChanged, this);
      this._addEventListener(this._remotePlayerController, eventTypes.VOLUME_LEVEL_CHANGED, this._triggerVolumeChangeEvent, this);
      this._addEventListener(this._remotePlayerController, eventTypes.IS_MUTED_CHANGED, this._triggerVolumeChangeEvent, this);
      this._addEventListener(this._remotePlayerController, eventTypes.CURRENT_TIME_CHANGED, this._triggerTimeUpdateEvent, this);
      this._addEventListener(this._remotePlayerController, eventTypes.DURATION_CHANGED, this._triggerDurationChangeEvent, this);
      // If any subtitles were loaded on cast receiver side,
      // check if they exist on web player side, if not add them
      this._addEventListener(this._remotePlayerController, eventTypes.MEDIA_INFO_CHANGED, (event) => {
         this.videojsPlayer.remoteTextTracks();
         const alreadyLoadedTracks = this.videojsPlayer.remoteTextTracks().tracks_;

         const player = this.videojsPlayer;

         if (event.value && event.value.tracks) {
            event.value.tracks.forEach(function(track) {
               const isAlreadyLoaded = alreadyLoadedTracks.some(function(alreadyLoadedTrack) {
                  return alreadyLoadedTrack.id === track.name;
               });

               if (!isAlreadyLoaded) {
                  track.id = track.name;
                  player.addRemoteTextTrack(track);
               }
            });
         }

      });
      this._addEventListener(this._remotePlayerController, eventTypes.MEDIA_INFO_CHANGED, this._handleMediaInfoChangeEvent, this);
   },

   /**
    * Registers an event listener on the given target object. Because many objects in the
    * Chromecast API are either singletons or must be shared between instances of
    * `ChromecastTech` for the lifetime of the player, we must unbind the listeners when
    * this Tech instance is destroyed to prevent memory leaks. To do that, we need to keep
    * a reference to listeners that are added to global objects so that we can use those
    * references to remove the listener when this Tech is destroyed.
    *
    * @param target {object} the object to register the event listener on
    * @param type {string} the name of the event
    * @param callback {Function} the listener's callback function that executes when the
    * event is emitted
    * @param context {object} the `this` context to use when executing the `callback`
    * @private
    */
   _addEventListener: function(target, type, callback, context) {
      var listener;

      listener = {
         target: target,
         type: type,
         callback: callback,
         context: context,
         listener: callback.bind(context),
      };
      target.addEventListener(type, listener.listener);
      this._eventListeners.push(listener);
   },

   /**
    * _onDispose
    * @private
    */
   _onDispose: function() {
      var textTrackDisplay = this.videojsPlayer.getChild('TextTrackDisplay');

      if (textTrackDisplay) {
         textTrackDisplay.show();
      }
      clearTimeout(this.playStateValidationTimeout);
      this._removeAllEventListeners();
      // even with `stopCasting === false`, `endCurrentSession` *stops* casting
      // this._getCastContext().endCurrentSession(/* stopCasting */ false);
   },

   /**
    * Removes all event listeners that were registered with global objects during the
    * lifetime of this Tech. See {@link _addEventListener} for more information about why
    * this is necessary.
    *
    * @private
    */
   _removeAllEventListeners: function() {
      while (this._eventListeners.length > 0) {
         this._removeEventListener(this._eventListeners[0]);
      }
      this._eventListeners = [];
   },

   /**
    * Removes a single event listener that was registered with global objects during the
    * lifetime of this Tech. See {@link _addEventListener} for more information about why
    * this is necessary.
    *
    * @private
    */
   _removeEventListener: function(listener) {
      var index = -1,
          pass = false,
          i;

      listener.target.removeEventListener(listener.type, listener.listener);

      for (i = 0; i < this._eventListeners.length; i++) {
         pass = this._eventListeners[i].target === listener.target &&
               this._eventListeners[i].type === listener.type &&
               this._eventListeners[i].callback === listener.callback &&
               this._eventListeners[i].context === listener.context;

         if (pass) {
            index = i;
            break;
         }
      }

      if (index !== -1) {
         this._eventListeners.splice(index, 1);
      }
   },

   /**
    * Handles Chromecast player state change events. The player may "change state" when
    * paused, played, buffering, etc.
    *
    * @private
    */
   _onPlayerStateChanged: function() {
      var states = chrome.cast.media.PlayerState,
          playerState = this._remotePlayer.playerState;

      if (playerState === states.PLAYING) {
         this._hasPlayedCurrentItem = true;
         this.trigger('play');
         this.trigger('playing');
      } else if (playerState === states.PAUSED) {
         this.trigger('pause');
      } else if ((playerState === states.IDLE && this.ended()) || (playerState === null && this._hasPlayedCurrentItem)) {
         this._hasPlayedCurrentItem = false;
         this._closeSessionOnTimeout();
         this.trigger('ended');
         this._triggerTimeUpdateEvent();
      } else if (playerState === states.BUFFERING) {
         this.trigger('waiting');
      }
   },

   /**
    * Handles Chromecast MediaSession state change events. The only property sent to this
    * event is whether the session is alive. This is useful for determining if an item has
    * ended as the MediaSession will fire this event with `false` then be immediately
    * destroyed. This means that we cannot trust `idleReason` to show whether an item has
    * ended since we may no longer have access to the MediaSession.
    *
    * @private
    */
   _onMediaSessionStatusChanged: function(isAlive) {
      this._hasMediaSessionEnded = !!isAlive;
   },

   /**
    * Ends the session after a certain number of seconds of inactivity.
    *
    * If the Chromecast player is in the "IDLE" state after an item has ended, and no
    * further items are queued up to play, the session is considered inactive. Once a
    * period of time (currently 10 seconds) has elapsed with no activity, we manually end
    * the session to prevent long periods of a blank Chromecast screen that is shown at
    * the end of item playback.
    *
    * @private
    */
   _closeSessionOnTimeout: function() {
      // Ensure that there's never more than one session timeout active
      this._clearSessionTimeout();
      this._sessionTimeoutID = setTimeout(function() {
         var castSession = this._getCastSession();

         if (castSession) {
            castSession.endSession(true);
         }
         this._clearSessionTimeout();
      }.bind(this), SESSION_TIMEOUT);
   },

   /**
    * Stops the timeout that is waiting during a period of inactivity in order to close
    * the session.
    *
    * @private
    * @see _closeSessionOnTimeout
    */
   _clearSessionTimeout: function() {
      if (this._sessionTimeoutID) {
         clearTimeout(this._sessionTimeoutID);
         this._sessionTimeoutID = false;
      }
   },

   /**
    * @private
    * @return {object} the current CastContext, if one exists
    */
   _getCastContext: function() {
      return this._chromecastSessionManager.getCastContext();
   },

   /**
    * @private
    * @return {object} the current CastSession, if one exists
    */
   _getCastSession: function() {
      return this._getCastContext().getCurrentSession();
   },

   /**
    * @private
    * @return {object} the current MediaSession, if one exists
    * @see https://developers.google.com/cast/docs/reference/chrome/chrome.cast.media.Media
    */
   _getMediaSession: function() {
      var castSession = this._getCastSession();

      return castSession ? castSession.getMediaSession() : null;
   },

   /**
    * Triggers a 'volumechange' event
    * @private
    * @see http://docs.videojs.com/Player.html#event:volumechange
    */
   _triggerVolumeChangeEvent: function() {
      this.trigger('volumechange');
   },

   /**
    * Triggers a 'timeupdate' event
    * @private
    * @see http://docs.videojs.com/Player.html#event:timeupdate
    */
   _triggerTimeUpdateEvent: function() {
      this.trigger('timeupdate');
   },

   /**
    * Triggers a 'durationchange' event
    * @private
    * @see http://docs.videojs.com/Player.html#event:durationchange
    */
   _triggerDurationChangeEvent: function() {
      this.trigger('durationchange');
   },

   /**
    * @private
    */
   _handleMediaInfoChangeEvent: function(event) {
      if (event && event.value && event.value.entity) {
         this._requestQueueItemChange(event.value.entity);
      }
   },

   /**
    * Triggers an 'error' event
    * @private
    * @see http://docs.videojs.com/Player.html#event:error
    */
   _triggerErrorEvent: function() {
      this.trigger('error');
   },
};

/**
 * Registers the ChromecastTech Tech with Video.js. Calls {@link
 * http://docs.videojs.com/Tech.html#.registerTech}, which will add a Tech called
 * `chromecast` to the list of globally registered Video.js Tech implementations.
 *
 * [Video.js Tech](http://docs.videojs.com/Tech.html) are initialized and used
 * automatically by Video.js Player instances. Whenever a new source is set on the player,
 * the player iterates through the list of available Tech to determine which to use to
 * play the source.
 *
 * @param videojs {object} A reference to
 * {@link http://docs.videojs.com/module-videojs.html|Video.js}
 * @see http://docs.videojs.com/Tech.html#.registerTech
 */
module.exports = function(videojs) {
   var Tech = videojs.getComponent('Tech'),
       ChromecastTechImpl;

   ChromecastTechImpl = videojs.extend(Tech, ChromecastTech);

   // Required for Video.js Tech implementations.
   // TODO Consider a more comprehensive check based on mimetype.
   ChromecastTechImpl.canPlaySource = () => { return ChromecastSessionManager.isChromecastConnected(); };
   ChromecastTechImpl.isSupported = () => { return ChromecastSessionManager.isChromecastConnected(); };

   ChromecastTechImpl.prototype.featuresVolumeControl = true;
   ChromecastTechImpl.prototype.featuresPlaybackRate = false;
   ChromecastTechImpl.prototype.movingMediaElementInDOM = false;
   ChromecastTechImpl.prototype.featuresFullscreenResize = true;
   ChromecastTechImpl.prototype.featuresTimeupdateEvents = true;
   ChromecastTechImpl.prototype.featuresProgressEvents = false;
   ChromecastTechImpl.prototype.featuresNativeTextTracks = true;
   ChromecastTechImpl.prototype.featuresNativeAudioTracks = false;
   ChromecastTechImpl.prototype.featuresNativeVideoTracks = false;

   // Give ChromecastTech class instances a reference to videojs
   ChromecastTechImpl.prototype.videojs = videojs;

   videojs.registerTech('chromecast', ChromecastTechImpl);
};
