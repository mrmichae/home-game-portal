#include "FCEUmmBridge.h"

#include <libretro.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define HGP_AUDIO_CAPACITY_FRAMES 96000

struct HGPFCEUmm {
    bool loaded;
    uint16_t input[2];
    uint16_t *video;
    size_t video_capacity;
    unsigned width;
    unsigned height;
    size_t pitch;
    int16_t *audio;
    size_t audio_frames;
    char system_directory[1024];
    char save_directory[1024];
    struct retro_system_av_info av;
};

static HGPFCEUmm *active_core;

static void hgp_log(enum retro_log_level level, const char *format, ...) {
    (void)level;
    va_list arguments;
    va_start(arguments, format);
    vfprintf(stderr, format, arguments);
    va_end(arguments);
}

static bool hgp_environment(unsigned command, void *data) {
    if (!active_core) return false;
    switch (command) {
        case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
            return *(const enum retro_pixel_format *)data == RETRO_PIXEL_FORMAT_RGB565;
        case RETRO_ENVIRONMENT_GET_CAN_DUPE:
            *(bool *)data = true;
            return true;
        case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
            *(const char **)data = active_core->system_directory;
            return true;
        case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
            *(const char **)data = active_core->save_directory;
            return true;
        case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
            ((struct retro_log_callback *)data)->log = hgp_log;
            return true;
        case RETRO_ENVIRONMENT_GET_LANGUAGE:
            *(unsigned *)data = RETRO_LANGUAGE_ENGLISH;
            return true;
        case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS:
            return true;
        case RETRO_ENVIRONMENT_GET_MESSAGE_INTERFACE_VERSION:
            *(unsigned *)data = 1;
            return true;
        case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION:
            *(unsigned *)data = 2;
            return true;
        case RETRO_ENVIRONMENT_SET_VARIABLES:
        case RETRO_ENVIRONMENT_SET_CORE_OPTIONS:
        case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_INTL:
        case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2:
        case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2_INTL:
        case RETRO_ENVIRONMENT_SET_CONTROLLER_INFO:
        case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
        case RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME:
        case RETRO_ENVIRONMENT_SET_GEOMETRY:
        case RETRO_ENVIRONMENT_SET_MESSAGE:
        case RETRO_ENVIRONMENT_SET_MESSAGE_EXT:
            return true;
        case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
            *(bool *)data = false;
            return true;
        case RETRO_ENVIRONMENT_GET_VARIABLE:
            ((struct retro_variable *)data)->value = NULL;
            return false;
        default:
            return false;
    }
}

static void hgp_video(const void *data, unsigned width, unsigned height, size_t pitch) {
    if (!active_core || !data || data == RETRO_HW_FRAME_BUFFER_VALID) return;
    const size_t required = pitch * height;
    if (required > active_core->video_capacity) {
        void *resized = realloc(active_core->video, required);
        if (!resized) return;
        active_core->video = resized;
        active_core->video_capacity = required;
    }
    memcpy(active_core->video, data, required);
    active_core->width = width;
    active_core->height = height;
    active_core->pitch = pitch;
}

static void hgp_audio_sample(int16_t left, int16_t right) {
    if (!active_core || active_core->audio_frames >= HGP_AUDIO_CAPACITY_FRAMES) return;
    active_core->audio[active_core->audio_frames * 2] = left;
    active_core->audio[active_core->audio_frames * 2 + 1] = right;
    active_core->audio_frames += 1;
}

static size_t hgp_audio_batch(const int16_t *data, size_t frames) {
    if (!active_core || !data) return frames;
    const size_t available = HGP_AUDIO_CAPACITY_FRAMES - active_core->audio_frames;
    const size_t copied = frames < available ? frames : available;
    memcpy(active_core->audio + active_core->audio_frames * 2, data, copied * 2 * sizeof(int16_t));
    active_core->audio_frames += copied;
    return frames;
}

static void hgp_input_poll(void) {}

static int16_t hgp_input_state(unsigned port, unsigned device, unsigned index, unsigned id) {
    (void)index;
    if (!active_core || port >= 2 || (device & RETRO_DEVICE_MASK) != RETRO_DEVICE_JOYPAD) return 0;
    if (id == RETRO_DEVICE_ID_JOYPAD_MASK) return (int16_t)active_core->input[port];
    if (id > RETRO_DEVICE_ID_JOYPAD_R3) return 0;
    return (active_core->input[port] & (1u << id)) != 0;
}

HGPFCEUmm *hgp_fceumm_create(const char *system_directory, const char *save_directory) {
    if (active_core) return NULL;
    HGPFCEUmm *core = calloc(1, sizeof(*core));
    if (!core) return NULL;
    core->audio = calloc(HGP_AUDIO_CAPACITY_FRAMES * 2, sizeof(int16_t));
    if (!core->audio) { free(core); return NULL; }
    snprintf(core->system_directory, sizeof(core->system_directory), "%s", system_directory ? system_directory : "");
    snprintf(core->save_directory, sizeof(core->save_directory), "%s", save_directory ? save_directory : "");
    active_core = core;
    retro_set_environment(hgp_environment);
    retro_set_video_refresh(hgp_video);
    retro_set_audio_sample(hgp_audio_sample);
    retro_set_audio_sample_batch(hgp_audio_batch);
    retro_set_input_poll(hgp_input_poll);
    retro_set_input_state(hgp_input_state);
    retro_init();
    retro_get_system_av_info(&core->av);
    return core;
}

void hgp_fceumm_destroy(HGPFCEUmm *core) {
    if (!core || core != active_core) return;
    hgp_fceumm_unload(core);
    retro_deinit();
    free(core->video);
    free(core->audio);
    free(core);
    active_core = NULL;
}

bool hgp_fceumm_load(HGPFCEUmm *core, const void *rom_bytes, size_t byte_count) {
    if (!core || core != active_core || !rom_bytes || byte_count == 0) return false;
    if (core->loaded) hgp_fceumm_unload(core);
    const struct retro_game_info game = { .path = NULL, .data = rom_bytes, .size = byte_count, .meta = NULL };
    core->loaded = retro_load_game(&game);
    if (core->loaded) {
        retro_set_controller_port_device(0, RETRO_DEVICE_JOYPAD);
        retro_set_controller_port_device(1, RETRO_DEVICE_JOYPAD);
        retro_get_system_av_info(&core->av);
    }
    return core->loaded;
}

void hgp_fceumm_unload(HGPFCEUmm *core) {
    if (!core || core != active_core || !core->loaded) return;
    retro_unload_game();
    core->loaded = false;
}

void hgp_fceumm_set_input(HGPFCEUmm *core, unsigned player, uint16_t button_mask) {
    if (!core || core != active_core || player >= 2) return;
    core->input[player] = button_mask;
}

bool hgp_fceumm_run_frame(HGPFCEUmm *core) {
    if (!core || core != active_core || !core->loaded) return false;
    retro_run();
    return true;
}

const uint16_t *hgp_fceumm_video(HGPFCEUmm *core, unsigned *width, unsigned *height, size_t *pitch_bytes) {
    if (!core || core != active_core) return NULL;
    if (width) *width = core->width;
    if (height) *height = core->height;
    if (pitch_bytes) *pitch_bytes = core->pitch;
    return core->video;
}

size_t hgp_fceumm_read_audio(HGPFCEUmm *core, int16_t *destination, size_t maximum_frames) {
    if (!core || core != active_core || !destination) return 0;
    const size_t count = core->audio_frames < maximum_frames ? core->audio_frames : maximum_frames;
    memcpy(destination, core->audio, count * 2 * sizeof(int16_t));
    const size_t remaining = core->audio_frames - count;
    memmove(core->audio, core->audio + count * 2, remaining * 2 * sizeof(int16_t));
    core->audio_frames = remaining;
    return count;
}

double hgp_fceumm_frames_per_second(HGPFCEUmm *core) {
    return core ? core->av.timing.fps : 0;
}

double hgp_fceumm_audio_sample_rate(HGPFCEUmm *core) {
    return core ? core->av.timing.sample_rate : 0;
}

size_t hgp_fceumm_serialize_size(HGPFCEUmm *core) {
    return core && core->loaded ? retro_serialize_size() : 0;
}

bool hgp_fceumm_serialize(HGPFCEUmm *core, void *destination, size_t byte_count) {
    return core && core->loaded && destination && retro_serialize(destination, byte_count);
}

bool hgp_fceumm_unserialize(HGPFCEUmm *core, const void *state_bytes, size_t byte_count) {
    return core && core->loaded && state_bytes && retro_unserialize(state_bytes, byte_count);
}
