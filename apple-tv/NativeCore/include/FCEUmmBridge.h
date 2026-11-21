#ifndef HGP_FCEUMM_BRIDGE_H
#define HGP_FCEUMM_BRIDGE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct HGPFCEUmm HGPFCEUmm;

HGPFCEUmm *hgp_fceumm_create(const char *system_directory, const char *save_directory);
void hgp_fceumm_destroy(HGPFCEUmm *core);
bool hgp_fceumm_load(HGPFCEUmm *core, const void *rom_bytes, size_t byte_count);
void hgp_fceumm_unload(HGPFCEUmm *core);
void hgp_fceumm_set_input(HGPFCEUmm *core, unsigned player, uint16_t button_mask);
bool hgp_fceumm_run_frame(HGPFCEUmm *core);

const uint16_t *hgp_fceumm_video(
    HGPFCEUmm *core,
    unsigned *width,
    unsigned *height,
    size_t *pitch_bytes
);
size_t hgp_fceumm_read_audio(HGPFCEUmm *core, int16_t *destination, size_t maximum_frames);
double hgp_fceumm_frames_per_second(HGPFCEUmm *core);
double hgp_fceumm_audio_sample_rate(HGPFCEUmm *core);

size_t hgp_fceumm_serialize_size(HGPFCEUmm *core);
bool hgp_fceumm_serialize(HGPFCEUmm *core, void *destination, size_t byte_count);
bool hgp_fceumm_unserialize(HGPFCEUmm *core, const void *state_bytes, size_t byte_count);

#endif
