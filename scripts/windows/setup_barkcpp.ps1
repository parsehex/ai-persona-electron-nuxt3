# https://github.com/PABannier/bark.cpp#usage

# Check if the directory bark.cpp exists
if (!(Test-Path -Path bark.cpp)) {
	# Clone the repository if the directory does not exist
	git clone --recursive https://github.com/PABannier/bark.cpp.git

	# Change the current directory to bark.cpp
	Set-Location -Path bark.cpp

	git submodule update --init --recursive

	# Create the build directory if it does not exist
	if (!(Test-Path -Path build)) {
		New-Item -ItemType Directory -Path build
	}

	# Change the current directory to build
	Set-Location -Path build

	# Build
	cmake ..
	cmake --build . --config Release

	Set-Location -Path ..
} else {
	# print
	Write-Host "bark.cpp already exists."
}


# ask whether to download weights
$downloadWeights = Read-Host -Prompt "Download weights? Python should be installed. (y/n)"
if ($downloadWeights -eq "y") {
	Set-Location -Path bark.cpp
	python -m venv venv
	.\venv\Scripts\Activate.ps1
	pip install -r requirements.txt
	python download_weights.py --out-dir ./models --models bark-small bark
	python convert.py --dir-model ./models/bark-small --use-f16

	# usage
	# ./build/examples/main/main -m ./models/bark-small/ggml_weights.bin -p "this is an audio generated by bark.cpp" -t 4

	# didnt work for me
}
