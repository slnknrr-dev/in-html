// stitch/threads-dmc.js - the DMC Mouliné Spécial (stranded cotton, art. 117) colour table: number, an sRGB
// approximation and the colour name. DMC publishes no RGB values; these come from public colour tables (the
// classic range as listed by threadcolors.com, the 2017 colours 01-35 from a public RGB conversion chart). Screen
// colours are approximations: check a real shade card before buying thread.
// One line per colour: `<number> <rrggbb> <name>`.

// Why one text block and not an array of objects: much smaller in source and in the bundle, diffable line by
// line against the source table, and parsed once, lazily, by threads.js buildDMC (a regex per line; malformed lines
// are skipped). Order: White variants, the 2017 colours 01-35, then the classic numbers.
export const DMC_TABLE = `
B5200 ffffff Snow White
White fcfbf8 White
Ecru f0eada Ecru
01 e3e3e6 White Tin
02 d7d7d8 Tin
03 b8b8bb Tin Medium
04 aeaeb1 Tin Dark
05 e3ccbe Driftwood Light
06 dcc6b8 Driftwood Medium Light
07 8f7b6e Driftwood
08 6a5046 Driftwood Dark
09 552014 Cocoa Very Dark
10 edfed9 Tender Green Very Light
11 e2edb5 Tender Green Light
12 cdd99a Tender Green
13 bff6e0 Nile Green Medium Light
14 d0fbb2 Apple Green Pale
15 d1eda4 Apple Green
16 c9c258 Chartreuse Light
17 e5e272 Yellow Plum Light
18 d9d56d Yellow Plum
19 f7c95f Autumn Gold Medium Light
20 f7af93 Shrimp
21 d79982 Alizarin Light
22 bc604e Alizarin
23 ede2ed Apple Blossom
24 e0d7ee White Lavender
25 dad2e9 Lavender Ultra Light
26 d7cae6 Lavender Pale
27 f0eef9 White Violet
28 9086a9 Eggplant Medium Light
29 674076 Eggplant
30 7d77a5 Blueberry Medium Light
31 50518d Blueberry
32 4d2e8a Blueberry Dark
33 9c599c Fuchsia
34 7d3064 Fuchsia Dark
35 46052d Fuchsia Very Dark
3713 ffe2e2 Salmon Very Light
761 ffc9c9 Salmon Light
760 f5adad Salmon
3712 f18787 Salmon Medium
3328 e36d6d Salmon Dark
347 bf2d2d Salmon Very Dark
353 fed7cc Peach
352 fd9c97 Coral Light
351 e96a67 Coral
350 e04848 Coral Medium
349 d21035 Coral Dark
817 bb051f Coral Red Very Dark
3708 ffcbd5 Melon Light
3706 ffadbc Melon Medium
3705 ff7992 Melon Dark
3801 e74967 Melon Very Dark
666 e31d42 Bright Red
321 c72b3b Red
304 b71f33 Red Medium
498 a7132b Red Dark
816 970b23 Garnet
815 87071f Garnet Medium
814 7b001b Garnet Dark
894 ffb2bb Carnation Very Light
893 fc90a2 Carnation Light
892 ff798c Carnation Medium
891 ff5773 Carnation Dark
818 ffdfd9 Baby Pink
957 fdb5b5 Geranium Pale
956 ff9191 Geranium
309 d62b5b Rose Dark
963 ffd7d7 Dusty Rose Ultra Very Light
3716 ffbdbd Dusty Rose Medium Very Light
962 e68a8a Dusty Rose Medium
961 cf7373 Dusty Rose Dark
3833 ea8699 Raspberry Light
3832 db556e Raspberry Medium
3831 b32f48 Raspberry Dark
777 913546 Raspberry Very Dark
819 ffeeeb Baby Pink Light
3326 fbadb4 Rose Light
776 fcb0b9 Pink Medium
899 f27688 Rose Medium
335 ee546e Rose
326 b33b4b Rose Very Dark
151 f0ced4 Dusty Rose Very Light
3354 e4a6ac Dusty Rose Light
3733 e8879b Dusty Rose
3731 da6783 Dusty Rose Very Dark
3350 bc4365 Dusty Rose Ultra Dark
150 ab0249 Dusty Rose Ultra Very Dark
3689 fbbfc2 Mauve Light
3688 e7a9ac Mauve Medium
3687 c96b70 Mauve
3803 ab3357 Mauve Dark
3685 881531 Mauve Very Dark
605 ffc0cd Cranberry Very Light
604 ffb0be Cranberry Light
603 ffa4be Cranberry
602 e24874 Cranberry Medium
601 d1286a Cranberry Dark
600 cd2f63 Cranberry Very Dark
3806 ff8cae Cyclamen Pink Light
3805 f3478b Cyclamen Pink
3804 e02876 Cyclamen Pink Dark
3609 f4aed5 Plum Ultra Light
3608 ea9cc4 Plum Very Light
3607 c54989 Plum Light
718 9c2462 Plum
917 9b1359 Plum Medium
915 820043 Plum Dark
225 ffdfd5 Shell Pink Ultra Very Light
224 ebb7af Shell Pink Very Light
152 e2a099 Shell Pink Medium Light
223 cc847c Shell Pink Light
3722 bc6c64 Shell Pink Medium
3721 a14b51 Shell Pink Dark
221 883e43 Shell Pink Very Dark
778 dfb3bb Antique Mauve Very Light
3727 dba9b2 Antique Mauve Light
316 b7737f Antique Mauve Medium
3726 9b5b66 Antique Mauve Dark
315 814952 Antique Mauve Medium Dark
3802 714149 Antique Mauve Very Dark
902 822637 Garnet Very Dark
3743 d7cbd3 Antique Violet Very Light
3042 b79da7 Antique Violet Light
3041 956f7c Antique Violet Medium
3740 785762 Antique Violet Dark
3836 ba91aa Grape Light
3835 946083 Grape Medium
3834 72375d Grape Dark
154 572433 Grape Very Dark
211 e3cbe3 Lavender Light
210 c39fc3 Lavender Medium
209 a37ba7 Lavender Dark
208 835b8b Lavender Very Dark
3837 6c3a6e Lavender Ultra Dark
327 633666 Violet Dark
153 e6ccd9 Violet Very Light
554 dbb3cb Violet Light
553 a3638b Violet
552 803a6b Violet Medium
550 5c184e Violet Very Dark
3747 d3d7ed Blue Violet Very Light
341 b7bfdd Blue Violet Light
156 a3aed1 Blue Violet Medium Light
340 ada7c7 Blue Violet Medium
155 9891b6 Blue Violet Medium Dark
3746 776b98 Blue Violet Dark
333 5c5478 Blue Violet Very Dark
157 bbc3d9 Cornflower Blue Very Light
794 8f9cc1 Cornflower Blue Light
793 707da2 Cornflower Blue Medium
3807 60678c Cornflower Blue
792 555b7b Cornflower Blue Dark
158 4c526e Cornflower Blue Medium Very Dark
791 464563 Cornflower Blue Very Dark
3840 b0c0da Lavender Blue Light
3839 7b8eab Lavender Blue Medium
3838 5c7294 Lavender Blue Dark
800 c0ccde Delft Blue Pale
809 94a8c6 Delft Blue
799 748eb6 Delft Blue Medium
798 466a8e Delft Blue Dark
797 13477d Royal Blue
796 11416d Royal Blue Dark
820 0e365c Royal Blue Very Dark
162 dbecf5 Blue Ultra Very Light
827 bddded Blue Very Light
813 a1c2d7 Blue Light
826 6b9ebf Blue Medium
825 4781a5 Blue Dark
824 396987 Blue Very Dark
996 30c2ec Electric Blue Medium
3843 14aad0 Electric Blue
995 2696b6 Electric Blue Dark
3846 06e3e6 Turquoise Bright Light
3845 04c4ca Turquoise Bright Medium
3844 12aeba Turquoise Bright Dark
159 c7cad7 Blue Gray Light
160 999fb7 Blue Gray Medium
161 7880a4 Blue Gray
3756 eefcfc Baby Blue Ultra Very Light
775 d9ebf1 Baby Blue Very Light
3841 cddfed Baby Blue Pale
3325 b8d2e6 Baby Blue Light
3755 93b4ce Baby Blue
334 739fc1 Baby Blue Medium
322 5a8fb8 Baby Blue Dark
312 35668b Baby Blue Very Dark
803 2c597c Baby Blue Ultra Very Dark
336 253b73 Navy Blue
823 213063 Navy Blue Dark
939 1b2853 Navy Blue Very Dark
3753 dbe2e9 Antique Blue Ultra Very Light
3752 c7d1db Antique Blue Very Light
932 a2b5c6 Antique Blue Light
931 6a859e Antique Blue Medium
930 455c71 Antique Blue Dark
3750 384c5e Antique Blue Very Dark
828 c5e8ed Sky Blue Very Light
3761 acd8e2 Sky Blue Light
519 7eb1c8 Sky Blue
518 4f93a7 Wedgewood Light
3760 3e85a2 Wedgewood Medium
517 3b768f Wedgewood Dark
3842 32667c Wedgewood Very Dark
311 1c5066 Wedgewood Ultra Very Dark
747 e5fcfd Peacock Blue Very Light
3766 99cfd9 Peacock Blue Light
807 64abba Peacock Blue
806 3d95a5 Peacock Blue Dark
3765 347f8c Peacock Blue Very Dark
3811 bce3e6 Turquoise Very Light
598 90c3cc Turquoise Light
597 5ba3b3 Turquoise
3810 488e9a Turquoise Dark
3809 3f7c85 Turquoise Very Dark
3808 366970 Turquoise Ultra Very Dark
928 dde3e3 Gray Green Very Light
927 bdcbcb Gray Green Light
926 98aeae Gray Green Medium
3768 657f7f Gray Green Dark
924 566a6a Gray Green Very Dark
3849 52b3a4 Teal Green Light
3848 559392 Teal Green Medium
3847 347d75 Teal Green Dark
964 a9e2d8 Sea Green Light
959 59c7b4 Sea Green Medium
958 3eb6a1 Sea Green Dark
3812 2f8c84 Sea Green Very Dark
3851 49b3a1 Green Bright Light
943 3d9384 Green Bright Medium
3850 378477 Green Bright Dark
993 90c0b4 Aquamarine Very Light
992 6fae9f Aquamarine Light
3814 508b7d Aquamarine
991 477b6e Aquamarine Dark
966 b9d7c0 Jade Ultra Very Light
564 a7cdaf Jade Very Light
563 8fc098 Jade Light
562 53976a Jade Medium
505 338362 Jade Green
3817 99c3aa Celadon Green Light
3816 65a57d Celadon Green
163 4d8361 Celadon Green Medium
3815 477759 Celadon Green Dark
561 2c6a45 Celadon Green Very Dark
504 c4decc Blue Green Very Light
3813 b2d4bd Blue Green Light
503 7bac94 Blue Green Medium
502 5b9071 Blue Green
501 396f52 Blue Green Dark
500 044d33 Blue Green Very Dark
955 a2d6ad Nile Green Light
954 88ba91 Nile Green
913 6dab77 Nile Green Medium
912 1b9d6b Emerald Green Light
911 189065 Emerald Green Medium
910 187e56 Emerald Green Dark
909 156f49 Emerald Green Very Dark
3818 115a3b Emerald Green Ultra Very Dark
369 d7edcc Pistachio Green Very Light
368 a6c298 Pistachio Green Light
320 69885a Pistachio Green Medium
367 617a52 Pistachio Green Dark
319 205f2e Pistachio Green Very Dark
890 174923 Pistachio Green Ultra Very Dark
164 c8d8b8 Forest Green Light
989 8da675 Forest Green
988 738b5b Forest Green Medium
987 587141 Forest Green Dark
986 405230 Forest Green Very Dark
772 e4ecd4 Yellow Green Very Light
3348 ccd9b1 Yellow Green Light
3347 71935c Yellow Green Medium
3346 406a3a Hunter Green
3345 1b5915 Hunter Green Dark
895 1b5300 Hunter Green Very Dark
704 9ecf34 Chartreuse Bright
703 7bb547 Chartreuse
702 47a72f Kelly Green
701 3f8f29 Green Light
700 07731b Green Bright
699 056517 Green
907 c7e666 Parrot Green Light
906 7fb335 Parrot Green Medium
905 628a28 Parrot Green Dark
904 557822 Parrot Green Very Dark
472 d8e498 Avocado Green Ultra Light
471 aebf79 Avocado Green Very Light
470 94ab4f Avocado Green Light
469 72843c Avocado Green
937 627133 Avocado Green Medium
936 4c5826 Avocado Green Very Dark
935 424d21 Avocado Green Dark
934 313919 Avocado Green Black
523 abb197 Fern Green Light
3053 9ca482 Green Gray
3052 889268 Green Gray Medium
3051 5f6648 Green Gray Dark
524 c4cdac Fern Green Very Light
522 969e7e Fern Green
520 666d4f Fern Green Dark
3364 83975f Pine Green
3363 728256 Pine Green Medium
3362 5e6b47 Pine Green Dark
165 eff4a4 Moss Green Very Light
3819 e0e868 Moss Green Light
166 c0c840 Moss Green Medium Light
581 a7ae38 Moss Green
580 888d33 Moss Green Dark
734 c7c077 Olive Green Light
733 bcb34c Olive Green Medium
732 948c36 Olive Green
731 938b37 Olive Green Dark
730 827b30 Olive Green Very Dark
3013 b9b982 Khaki Green Light
3012 a6a75d Khaki Green Medium
3011 898a58 Khaki Green Dark
372 ccb784 Mustard Light
371 bfa671 Mustard
370 b89d64 Mustard Medium
834 dbbe7f Golden Olive Very Light
833 c8ab6c Golden Olive Light
832 bd9b51 Golden Olive
831 aa8f56 Golden Olive Medium
830 8d784b Golden Olive Dark
829 7e6b42 Golden Olive Very Dark
613 dcc4aa Drab Brown Very Light
612 bc9a78 Drab Brown Light
611 967656 Drab Brown
610 796047 Drab Brown Dark
3047 e7d6c1 Yellow Beige Light
3046 d8bc9a Yellow Beige Medium
3045 bc966a Yellow Beige Dark
167 a77c49 Yellow Beige Very Dark
746 fcfcee Off White
677 f5eccb Old Gold Very Light
422 c69f7b Hazelnut Brown Light
3828 b78b61 Hazelnut Brown
420 a07042 Hazelnut Brown Dark
869 835e39 Hazelnut Brown Very Dark
728 e4b468 Topaz
783 ce9124 Topaz Medium
782 ae7720 Topaz Dark
781 a26d20 Topaz Very Dark
780 94631a Topaz Ultra Very Dark
676 e5ce97 Old Gold Light
729 d0a53e Old Gold Medium
680 bc8d0e Old Gold Dark
3829 a98204 Old Gold Very Dark
3822 f6dc98 Straw Light
3821 f3ce75 Straw
3820 dfb65f Straw Dark
3852 cd9d37 Straw Very Dark
445 fffb8b Lemon Light
307 fded54 Lemon
973 ffe300 Canary Bright
444 ffd600 Lemon Dark
3078 fdf9cd Golden Yellow Very Light
727 fff1af Topaz Very Light
726 fdd755 Topaz Light
725 ffc840 Topaz Medium Light
972 ffb515 Canary Deep
745 ffe9ad Yellow Pale Light
744 ffe793 Yellow Pale
743 fed376 Yellow Medium
742 ffbf57 Tangerine Light
741 ffa32b Tangerine Medium
740 ff8b00 Tangerine
970 f78b13 Pumpkin Light
971 f67f00 Pumpkin
947 ff7b4d Burnt Orange
946 eb6307 Burnt Orange Medium
900 d15807 Burnt Orange Dark
967 ffded5 Apricot Very Light
3824 fecdc2 Apricot Light
3341 fcab98 Apricot
3340 ff836f Apricot Medium
608 fd5d35 Burnt Orange Bright
606 fa3203 Orange-Red Bright
951 ffe2cf Tawny Light
3856 ffd3b5 Mahogany Ultra Very Light
722 f7976f Orange Spice Light
721 f27842 Orange Spice Medium
720 e55c1f Orange Spice Dark
3825 fdbd96 Pumpkin Pale
922 e27323 Copper Light
921 c66218 Copper
920 ac5414 Copper Medium
919 a64510 Red Copper
918 82340a Red Copper Dark
3770 ffeee3 Tawny Very Light
945 fbd5bb Tawny
402 f7a777 Mahogany Very Light
3776 cf7939 Mahogany Light
301 b35f2b Mahogany Medium
400 8f430f Mahogany Dark
300 6f2f00 Mahogany Very Dark
3823 fffde3 Yellow Ultra Pale
3855 fad396 Autumn Gold Light
3854 f2af68 Autumn Gold Medium
3853 f29746 Autumn Gold Dark
3827 f7bb77 Golden Brown Pale
977 dc9c56 Golden Brown Light
976 c28142 Golden Brown Medium
3826 ad7239 Golden Brown
975 914f12 Golden Brown Dark
948 fee7da Peach Very Light
754 f7cbbf Peach Light
3771 f4bba9 Terra Cotta Ultra Very Light
758 eeaa9b Terra Cotta Very Light
3778 d98978 Terra Cotta Light
356 c56a5b Terra Cotta Medium
3830 b95544 Terra Cotta
355 984436 Terra Cotta Dark
3777 863022 Terra Cotta Very Dark
3779 f8cac8 Rosewood Ultra Very Light
3859 ba8b7c Rosewood Light
3858 964a3f Rosewood Medium
3857 68251a Rosewood Dark
3774 f3e1d7 Desert Sand Very Light
950 eed3c4 Desert Sand Light
3064 c48e70 Desert Sand
407 bb8161 Desert Sand Medium
3773 b67552 Desert Sand Dark
3772 a06c50 Desert Sand Very Dark
632 875539 Desert Sand Ultra Very Dark
453 d7cecb Shell Gray Light
452 c0b3ae Shell Gray Medium
451 917b73 Shell Gray Dark
3861 a68881 Cocoa Light
3860 7d5d57 Cocoa
779 624b45 Cocoa Dark
712 fffbef Cream
739 f8e4c8 Tan Ultra Very Light
738 eccc9e Tan Very Light
437 e4bb8e Tan Light
436 cb9051 Tan
435 b87748 Brown Very Light
434 985e33 Brown Light
433 7a451f Brown Medium
801 653919 Coffee Brown Dark
898 492a13 Coffee Brown Very Dark
938 361f0e Coffee Brown Ultra Dark
3371 1e1108 Black Brown
543 f2e3ce Beige Brown Ultra Very Light
3864 cbb69c Mocha Beige Light
3863 a4835c Mocha Beige Medium
3862 8a6e4e Mocha Beige Dark
3031 4b3c2a Mocha Brown Very Dark
3865 f9f7f1 Winter White
822 e7e2d3 Beige Gray Light
644 ddd8cb Beige Gray Medium
642 a49878 Beige Gray Dark
640 857b61 Beige Gray Very Dark
3787 625d50 Brown Gray Dark
3021 4f4b41 Brown Gray Very Dark
3024 ebeae7 Brown Gray Very Light
3023 b1aa97 Brown Gray Light
3022 8e9078 Brown Gray Medium
535 636458 Ash Gray Very Light
3033 e3d8cc Mocha Brown Very Light
3782 d2bca6 Mocha Brown Light
3032 b39f8b Mocha Brown Medium
3790 7f6a55 Beige Gray Ultra Dark
3781 6b5743 Mocha Brown Dark
3866 faf6f0 Mocha Brown Ultra Very Light
842 d1baa1 Beige Brown Very Light
841 b69b7e Beige Brown Light
840 9a7c5c Beige Brown Medium
839 675541 Beige Brown Dark
838 594937 Beige Brown Very Dark
3072 e6e8e8 Beaver Gray Very Light
648 bcb4ac Beaver Gray Light
647 b0a69c Beaver Gray Medium
646 877d73 Beaver Gray Dark
645 6e655c Beaver Gray Very Dark
844 484848 Beaver Gray Ultra Dark
762 ececec Pearl Gray Very Light
415 d3d3d6 Pearl Gray
318 ababab Steel Gray Light
414 8c8c8c Steel Gray Dark
168 d1d1d1 Pewter Very Light
169 848484 Pewter Light
317 6c6c6c Pewter Gray
413 565656 Pewter Gray Dark
3799 424242 Pewter Gray Very Dark
310 000000 Black
`;
